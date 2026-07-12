import browser from 'webextension-polyfill';

import type { CloudProviderId } from '../schemas';

interface SessionToken {
  accessToken: string;
  expiresAt: number;
}

const memoryFallback = new Map<string, SessionToken>();

function key(provider: CloudProviderId): string {
  return `gvCloudTokenV2:${provider}`;
}

export async function getSessionToken(provider: CloudProviderId): Promise<string | null> {
  const storageKey = key(provider);
  const result = browser.storage.session ? await browser.storage.session.get(storageKey) : {};
  const token = (result[storageKey] as SessionToken | undefined) ?? memoryFallback.get(storageKey);
  if (!token || typeof token.accessToken !== 'string' || typeof token.expiresAt !== 'number') {
    return null;
  }
  if (token.expiresAt <= Date.now() + 30_000) {
    if (browser.storage.session) await browser.storage.session.remove(storageKey);
    memoryFallback.delete(storageKey);
    return null;
  }
  return token.accessToken;
}

export async function setSessionToken(
  provider: CloudProviderId,
  accessToken: string,
  expiresInSeconds: number,
): Promise<void> {
  const storageKey = key(provider);
  const token = {
    accessToken,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  } satisfies SessionToken;
  if (browser.storage.session) await browser.storage.session.set({ [storageKey]: token });
  else memoryFallback.set(storageKey, token);
}

export async function clearSessionToken(provider: CloudProviderId): Promise<void> {
  const storageKey = key(provider);
  if (browser.storage.session) await browser.storage.session.remove(storageKey);
  memoryFallback.delete(storageKey);
}
