import { logger } from '@/core/services/LoggerService';
import { FeatureRuntime } from '@/core/v2/lifecycle';
import { SettingsV2Repository } from '@/core/v2/repositories';
import { M365PlatformAdapter } from '@/platforms/m365/M365PlatformAdapter';

const runtimeLogger = logger.createChild('M365Content');
const adapter = new M365PlatformAdapter();
const runtime = new FeatureRuntime();
let started = false;

async function start(): Promise<void> {
  if (started || !adapter.matches(window.location)) return;
  started = true;

  try {
    const settings = await new SettingsV2Repository().get();
    await runtime.start(adapter, settings);
  } catch (error) {
    started = false;
    runtimeLogger.error('Unable to initialize M365 features', { error });
  }
}

void start();

window.addEventListener(
  'pagehide',
  () => {
    void runtime.dispose();
  },
  { once: true },
);
