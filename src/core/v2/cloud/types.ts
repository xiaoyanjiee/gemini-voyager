import type { CloudProviderId } from '../schemas';
import type { CloudWorkspaceV2 } from './schemas';

export interface CloudProviderStatus {
  id: CloudProviderId;
  configured: boolean;
  authenticated: boolean;
  disabledReason?: string;
}

export interface CloudProvider {
  readonly id: CloudProviderId;
  authenticate(): Promise<void>;
  read(): Promise<CloudWorkspaceV2 | null>;
  write(workspace: CloudWorkspaceV2): Promise<void>;
  signOut(): Promise<void>;
  getStatus(): Promise<CloudProviderStatus>;
}

export type CloudSwitchStrategy = 'merge' | 'local-overwrite' | 'remote-replace';
