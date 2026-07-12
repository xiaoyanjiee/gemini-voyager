import browser from 'webextension-polyfill';

import { logger } from '@/core/services/LoggerService';

import {
  type SettingsV2,
  SettingsV2Schema,
  type WorkspaceV2,
  WorkspaceV2Schema,
  createDefaultSettingsV2,
  createEmptyWorkspaceV2,
} from './schemas';

export const V2_STORAGE_KEYS = {
  SETTINGS: 'gvSettingsV2',
  WORKSPACE: 'gvWorkspaceV2',
} as const;

const repositoryLogger = logger.createChild('V2Repository');

export class SettingsV2Repository {
  async get(): Promise<SettingsV2> {
    const result = await browser.storage.sync.get(V2_STORAGE_KEYS.SETTINGS);
    const parsed = SettingsV2Schema.safeParse(result[V2_STORAGE_KEYS.SETTINGS]);
    if (parsed.success) return parsed.data;

    if (result[V2_STORAGE_KEYS.SETTINGS] !== undefined) {
      repositoryLogger.warn('Ignoring invalid V2 settings', { issues: parsed.error.issues });
    }
    return createDefaultSettingsV2();
  }

  async set(settings: SettingsV2): Promise<void> {
    const validated = SettingsV2Schema.parse(settings);
    await browser.storage.sync.set({ [V2_STORAGE_KEYS.SETTINGS]: validated });
  }
}

export class WorkspaceV2Repository {
  async get(): Promise<WorkspaceV2> {
    const result = await browser.storage.local.get(V2_STORAGE_KEYS.WORKSPACE);
    const parsed = WorkspaceV2Schema.safeParse(result[V2_STORAGE_KEYS.WORKSPACE]);
    if (parsed.success) return parsed.data;

    if (result[V2_STORAGE_KEYS.WORKSPACE] !== undefined) {
      repositoryLogger.warn('Ignoring invalid V2 workspace', { issues: parsed.error.issues });
    }
    return createEmptyWorkspaceV2();
  }

  async set(workspace: WorkspaceV2): Promise<void> {
    const validated = WorkspaceV2Schema.parse(workspace);
    await browser.storage.local.set({ [V2_STORAGE_KEYS.WORKSPACE]: validated });
  }

  async update(mutator: (workspace: WorkspaceV2) => WorkspaceV2): Promise<WorkspaceV2> {
    const current = await this.get();
    const next = WorkspaceV2Schema.parse({
      ...mutator(structuredClone(current)),
      revision: current.revision + 1,
      updatedAt: Date.now(),
    });
    await this.set(next);
    return next;
  }
}

export const settingsV2Repository = new SettingsV2Repository();
export const workspaceV2Repository = new WorkspaceV2Repository();
