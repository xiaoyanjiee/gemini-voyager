import type { FeatureModule, PlatformAdapter } from '@/core/v2/lifecycle';
import { disposableFrom } from '@/core/v2/lifecycle';

const chatWidthFeature: FeatureModule = {
  id: 'm365.chat-width',
  isEnabled: ({ settings }) => settings.platforms.m365.enabled,
  async start(context) {
    const { startM365ChatWidth, stopM365ChatWidth } = await import('@/pages/content/m365ChatWidth');
    startM365ChatWidth(context.settings);
    return disposableFrom(stopM365ChatWidth);
  },
};

const dockFeature: FeatureModule = {
  id: 'm365.voyager-dock',
  isEnabled: ({ settings }) => settings.platforms.m365.enabled,
  async start() {
    const { startVoyagerDock, stopVoyagerDock } = await import('@/platforms/m365/ui/VoyagerDock');
    await startVoyagerDock();
    return disposableFrom(stopVoyagerDock);
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

const features = [chatWidthFeature, dockFeature, developerDiagnosticsFeature];

export class M365PlatformAdapter implements PlatformAdapter {
  readonly id = 'm365' as const;

  matches(currentLocation: Location): boolean {
    return currentLocation.hostname.toLowerCase() === 'm365.cloud.microsoft';
  }

  getFeatures(): readonly FeatureModule[] {
    return features;
  }
}
