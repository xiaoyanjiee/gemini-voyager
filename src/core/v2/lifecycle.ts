import { logger } from '@/core/services/LoggerService';

import type { PlatformId, SettingsV2 } from './schemas';

export interface Disposable {
  dispose(): void | Promise<void>;
}

export interface FeatureContext {
  platform: PlatformId;
  document: Document;
  location: Location;
  settings: SettingsV2;
  signal: AbortSignal;
}

export interface FeatureModule {
  readonly id: string;
  isEnabled(context: FeatureContext): boolean;
  start(context: FeatureContext): Promise<Disposable>;
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  matches(location: Location): boolean;
  getFeatures(): readonly FeatureModule[];
}

export class FeatureRuntime implements Disposable {
  private readonly abortController = new AbortController();
  private readonly disposables: Disposable[] = [];
  private readonly runtimeLogger = logger.createChild('FeatureRuntime');

  async start(adapter: PlatformAdapter, settings: SettingsV2): Promise<void> {
    const context: FeatureContext = {
      platform: adapter.id,
      document,
      location,
      settings,
      signal: this.abortController.signal,
    };

    for (const feature of adapter.getFeatures()) {
      if (!feature.isEnabled(context)) continue;
      try {
        this.disposables.push(await feature.start(context));
      } catch (error) {
        this.runtimeLogger.error(`Failed to start feature: ${feature.id}`, { error });
      }
    }
  }

  async dispose(): Promise<void> {
    this.abortController.abort();
    const pending = this.disposables.splice(0).reverse();
    for (const disposable of pending) {
      try {
        await disposable.dispose();
      } catch (error) {
        this.runtimeLogger.warn('Feature cleanup failed', { error });
      }
    }
  }
}

export function disposableFrom(cleanup: () => void | Promise<void>): Disposable {
  return { dispose: cleanup };
}
