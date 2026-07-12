import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OneDriveProvider } from '../OneDriveProvider';

describe('OneDriveProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stays disabled when no Entra client ID is configured', async () => {
    const status = await new OneDriveProvider('').getStatus();
    expect(status.configured).toBe(false);
    await expect(new OneDriveProvider('').authenticate()).rejects.toThrow('client ID');
  });

  it('does not persist refresh tokens or client secrets', async () => {
    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync('src/core/v2/cloud/OneDriveProvider.ts', 'utf8'),
    );
    expect(source).not.toContain('client_secret');
    expect(source).not.toContain('refresh_token');
    expect(source).not.toContain('offline_access');
  });
});
