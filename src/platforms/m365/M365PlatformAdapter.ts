import type { FeatureModule, PlatformAdapter } from '@/core/v2/lifecycle';
import { disposableFrom } from '@/core/v2/lifecycle';

const chatWidthFeature: FeatureModule = {
  id: 'm365.chat-width',
  isEnabled: ({ settings }) => settings.platforms.m365.enabled,
  async start() {
    const { startM365ChatWidth, stopM365ChatWidth } = await import('@/pages/content/m365ChatWidth');
    startM365ChatWidth();
    return disposableFrom(stopM365ChatWidth);
  },
};

const timelineFeature: FeatureModule = {
  id: 'm365.timeline',
  isEnabled: ({ settings }) =>
    settings.platforms.m365.enabled && settings.platforms.m365.timeline.enabled,
  async start() {
    const { startM365Timeline, stopM365Timeline } = await import('@/pages/content/m365Timeline');
    startM365Timeline();
    return disposableFrom(stopM365Timeline);
  },
};

const exportFeature: FeatureModule = {
  id: 'm365.export',
  isEnabled: ({ settings }) => settings.platforms.m365.enabled,
  async start() {
    const { startM365ExportUi, stopM365ExportUi } = await import('@/pages/content/m365ExportUi');
    startM365ExportUi();
    return disposableFrom(stopM365ExportUi);
  },
};

const developerDiagnosticsFeature: FeatureModule = {
  id: 'm365.developer-diagnostics',
  isEnabled: () => import.meta.env.DEV,
  async start() {
    const { startM365Diagnostics, stopM365Diagnostics } = await import(
      '@/pages/content/m365Diagnostics'
    );
    startM365Diagnostics();
    return disposableFrom(stopM365Diagnostics);
  },
};

const features = [chatWidthFeature, timelineFeature, exportFeature, developerDiagnosticsFeature];

export class M365PlatformAdapter implements PlatformAdapter {
  readonly id = 'm365' as const;

  matches(currentLocation: Location): boolean {
    return currentLocation.hostname.toLowerCase() === 'm365.cloud.microsoft';
  }

  getFeatures(): readonly FeatureModule[] {
    return features;
  }
}
