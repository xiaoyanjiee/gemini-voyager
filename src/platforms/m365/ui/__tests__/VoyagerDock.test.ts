import { afterEach, describe, expect, it } from 'vitest';

import { startVoyagerDock, stopVoyagerDock } from '../VoyagerDock';

describe('VoyagerDock', () => {
  afterEach(() => {
    stopVoyagerDock();
    document.body.innerHTML = '';
  });

  it('mounts once in an isolated shadow root and cleans up', async () => {
    await startVoyagerDock();
    await startVoyagerDock();

    const host = document.getElementById('gv-m365-voyager-dock');
    expect(document.querySelectorAll('#gv-m365-voyager-dock')).toHaveLength(1);
    expect(host?.shadowRoot).not.toBeNull();
    expect(host?.shadowRoot?.querySelector('.panel')?.hasAttribute('hidden')).toBe(true);

    host?.shadowRoot?.querySelector<HTMLButtonElement>('.launcher')?.click();
    expect(host?.shadowRoot?.querySelector('.panel')?.hasAttribute('hidden')).toBe(false);

    stopVoyagerDock();
    expect(document.getElementById('gv-m365-voyager-dock')).toBeNull();
  });

  it('uses Fluent-style solid colors without gradients or emoji', async () => {
    await startVoyagerDock();
    const text = document.getElementById('gv-m365-voyager-dock')?.shadowRoot?.textContent ?? '';

    expect(text).not.toContain('linear-gradient');
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
