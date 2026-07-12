import { settingsV2Repository, workspaceV2Repository } from '../repositories';
import type { CloudProviderId, WorkspaceV2 } from '../schemas';
import { mergeCloudWorkspaces } from './merge';
import type { CloudWorkspaceV2 } from './schemas';
import type { CloudProvider, CloudSwitchStrategy } from './types';

function toCloud(workspace: WorkspaceV2): CloudWorkspaceV2 {
  return {
    schemaVersion: 2,
    revision: workspace.revision,
    updatedAt: workspace.updatedAt,
    folders: workspace.folders,
    prompts: workspace.prompts,
    starred: workspace.starred,
  };
}

function applyCloud(local: WorkspaceV2, cloud: CloudWorkspaceV2): WorkspaceV2 {
  return {
    ...local,
    revision: cloud.revision,
    updatedAt: cloud.updatedAt,
    folders: cloud.folders,
    prompts: cloud.prompts,
    starred: cloud.starred,
  };
}

export class SyncCoordinator {
  private readonly providers = new Map<CloudProviderId, CloudProvider>();

  constructor(providers: readonly CloudProvider[]) {
    providers.forEach((provider) => this.providers.set(provider.id, provider));
  }

  async switchPrimary(providerId: CloudProviderId, strategy: CloudSwitchStrategy): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Cloud provider is not registered: ${providerId}`);
    const status = await provider.getStatus();
    if (!status.configured)
      throw new Error(status.disabledReason ?? 'Cloud provider is not configured');
    if (!status.authenticated) await provider.authenticate();

    const localWorkspace = await workspaceV2Repository.get();
    const local = toCloud(localWorkspace);
    const remote = await provider.read();
    if (strategy === 'local-overwrite' || !remote) {
      await provider.write(local);
    } else if (strategy === 'remote-replace') {
      await workspaceV2Repository.set(applyCloud(localWorkspace, remote));
    } else {
      const merged = mergeCloudWorkspaces(local, remote);
      await workspaceV2Repository.set(applyCloud(localWorkspace, merged));
      await provider.write(merged);
    }

    const settings = await settingsV2Repository.get();
    settings.activeCloudProvider = providerId;
    await settingsV2Repository.set(settings);
  }

  async sync(): Promise<void> {
    const settings = await settingsV2Repository.get();
    if (!settings.activeCloudProvider) return;
    await this.switchPrimary(settings.activeCloudProvider, 'merge');
  }
}
