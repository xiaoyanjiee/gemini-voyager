import { describe, expect, it } from 'vitest';

import { M365PlatformAdapter } from '../M365PlatformAdapter';

describe('M365PlatformAdapter', () => {
  it('matches only the supported M365 Copilot host', () => {
    const adapter = new M365PlatformAdapter();

    expect(
      adapter.matches(new URL('https://m365.cloud.microsoft/chat') as unknown as Location),
    ).toBe(true);
    expect(adapter.matches(new URL('https://gemini.google.com/app') as unknown as Location)).toBe(
      false,
    );
    expect(
      adapter.matches(new URL('https://m365.cloud.microsoft.example.com') as unknown as Location),
    ).toBe(false);
  });

  it('exposes stable feature identifiers', () => {
    const ids = new M365PlatformAdapter().getFeatures().map(({ id }) => id);

    expect(ids).toEqual([
      'm365.chat-width',
      'm365.timeline',
      'm365.export',
      'm365.developer-diagnostics',
    ]);
  });
});
