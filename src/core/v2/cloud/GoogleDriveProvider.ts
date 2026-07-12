import { z } from 'zod';

import { type CloudWorkspaceV2, CloudWorkspaceV2Schema } from './schemas';
import { clearSessionToken, getSessionToken, setSessionToken } from './tokenStore';
import type { CloudProvider, CloudProviderStatus } from './types';

const FILE_NAME = 'voyager-workspace-v2.json';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

function getAuthToken(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (result) => {
      const error = chrome.runtime.lastError;
      if (error) return reject(new Error(error.message));
      const token = typeof result === 'string' ? result : result?.token;
      if (!token) return reject(new Error('Google Drive authentication returned no access token'));
      resolve(token);
    });
  });
}

export class GoogleDriveProvider implements CloudProvider {
  readonly id = 'google-drive' as const;

  async authenticate(): Promise<void> {
    const token = await getAuthToken(true);
    await setSessionToken(this.id, token, 3600);
  }

  async read(): Promise<CloudWorkspaceV2 | null> {
    const token = await this.requireToken();
    const query = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const listResponse = await fetch(
      `${DRIVE_API}/files?q=${query}&fields=files(id,modifiedTime)&pageSize=10`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!listResponse.ok) throw new Error(`Google Drive list failed: ${listResponse.status}`);
    const list = (await listResponse.json()) as unknown;
    const parsedList = GoogleFileListSchema.parse(list);
    const file = parsedList.files.sort((a, b) =>
      (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''),
    )[0];
    if (!file) return null;
    const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Google Drive read failed: ${response.status}`);
    return CloudWorkspaceV2Schema.parse(await response.json());
  }

  async write(workspace: CloudWorkspaceV2): Promise<void> {
    const validated = CloudWorkspaceV2Schema.parse(workspace);
    const token = await this.requireToken();
    const existing = await this.findFileId(token);
    const metadata = JSON.stringify({ name: FILE_NAME, mimeType: 'application/json' });
    const boundary = `voyager-${crypto.randomUUID()}`;
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(validated)}\r\n--${boundary}--`;
    const url = existing
      ? `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(existing)}?uploadType=multipart`
      : `${DRIVE_UPLOAD_API}/files?uploadType=multipart`;
    const response = await fetch(url, {
      method: existing ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!response.ok) throw new Error(`Google Drive write failed: ${response.status}`);
  }

  async signOut(): Promise<void> {
    const token = await getSessionToken(this.id);
    await clearSessionToken(this.id);
    if (token) chrome.identity.removeCachedAuthToken({ token });
  }

  async getStatus(): Promise<CloudProviderStatus> {
    return {
      id: this.id,
      configured: true,
      authenticated: Boolean(await getSessionToken(this.id)),
    };
  }

  private async requireToken(): Promise<string> {
    const token = await getSessionToken(this.id);
    if (token) return token;
    const next = await getAuthToken(false);
    await setSessionToken(this.id, next, 3600);
    return next;
  }

  private async findFileId(token: string): Promise<string | null> {
    const query = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const response = await fetch(`${DRIVE_API}/files?q=${query}&fields=files(id)&pageSize=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Google Drive list failed: ${response.status}`);
    return GoogleFileListSchema.parse(await response.json()).files[0]?.id ?? null;
  }
}

const GoogleFileListSchema = z.object({
  files: z.array(z.object({ id: z.string().min(1), modifiedTime: z.string().optional() })),
});
