import { describe, expect, it } from 'vitest';

import { isM365Url } from '../PopupRouter';

describe('PopupRouter', () => {
  it('routes only the exact M365 host to the V2 control center', () => {
    expect(isM365Url('https://m365.cloud.microsoft/chat')).toBe(true);
    expect(isM365Url('https://gemini.google.com/app')).toBe(false);
    expect(isM365Url('https://m365.cloud.microsoft.example.com')).toBe(false);
    expect(isM365Url('not a url')).toBe(false);
  });
});
