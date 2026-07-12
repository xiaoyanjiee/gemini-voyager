import browser from 'webextension-polyfill';

import { type CloudWorkspaceV2, CloudWorkspaceV2Schema, OAuthTokenResponseSchema } from './schemas';
import { clearSessionToken, getSessionToken, setSessionToken } from './tokenStore';
import type { CloudProvider, CloudProviderStatus } from './types';

const GRAPH_FILE_URL =
  'https://graph.microsoft.com/v1.0/me/drive/special/approot:/voyager-workspace-v2.json:/content';
const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const REQUIRED_ORIGINS = ['https://graph.microsoft.com/*', 'https://login.microsoftonline.com/*'];

function base64Url(bytes: Uint8Array): string {
  let value = '';
  bytes.forEach((byte) => {
    value += String.fromCharCode(byte);
  });
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(64)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

function launchWebAuthFlow(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
      const error = chrome.runtime.lastError;
      if (error) return reject(new Error(error.message));
      if (!redirectUrl)
        return reject(new Error('OneDrive authentication returned no redirect URL'));
      resolve(redirectUrl);
    });
  });
}

export class OneDriveProvider implements CloudProvider {
  readonly id = 'onedrive' as const;
  constructor(private readonly clientId = import.meta.env.VITE_ONEDRIVE_CLIENT_ID ?? '') {}

  async authenticate(): Promise<void> {
    if (!this.clientId) throw new Error('OneDrive client ID is not configured');
    const granted = await browser.permissions.request({ origins: REQUIRED_ORIGINS });
    if (!granted) throw new Error('OneDrive host permission was not granted');
    const redirectUri = chrome.identity.getRedirectURL('onedrive');
    const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
    const pkce = await createPkce();
    const authorize = new URL(AUTHORIZE_URL);
    authorize.search = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: 'Files.ReadWrite.AppFolder',
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      state,
    }).toString();
    const redirect = new URL(await launchWebAuthFlow(authorize.href));
    if (redirect.searchParams.get('state') !== state)
      throw new Error('OneDrive OAuth state mismatch');
    const oauthError =
      redirect.searchParams.get('error_description') ?? redirect.searchParams.get('error');
    if (oauthError) throw new Error(`OneDrive authentication failed: ${oauthError}`);
    const code = redirect.searchParams.get('code');
    if (!code) throw new Error('OneDrive authentication returned no authorization code');
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: pkce.verifier,
      }),
    });
    if (!response.ok) throw new Error(`OneDrive token exchange failed: ${response.status}`);
    const token = OAuthTokenResponseSchema.parse(await response.json());
    await setSessionToken(this.id, token.access_token, token.expires_in);
  }

  async read(): Promise<CloudWorkspaceV2 | null> {
    const response = await fetch(GRAPH_FILE_URL, { headers: await this.authHeaders() });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`OneDrive read failed: ${response.status}`);
    return CloudWorkspaceV2Schema.parse(await response.json());
  }

  async write(workspace: CloudWorkspaceV2): Promise<void> {
    const response = await fetch(GRAPH_FILE_URL, {
      method: 'PUT',
      headers: { ...(await this.authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify(CloudWorkspaceV2Schema.parse(workspace)),
    });
    if (!response.ok) throw new Error(`OneDrive write failed: ${response.status}`);
  }

  async signOut(): Promise<void> {
    await clearSessionToken(this.id);
  }

  async getStatus(): Promise<CloudProviderStatus> {
    return {
      id: this.id,
      configured: Boolean(this.clientId),
      authenticated: Boolean(await getSessionToken(this.id)),
      ...(!this.clientId ? { disabledReason: 'OneDrive client ID is not configured' } : {}),
    };
  }

  private async authHeaders(): Promise<{ Authorization: string }> {
    const token = await getSessionToken(this.id);
    if (!token) throw new Error('OneDrive session has expired; authenticate again');
    return { Authorization: `Bearer ${token}` };
  }
}
