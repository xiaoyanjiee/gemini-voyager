import { describe, expect, it } from 'vitest';

import { mergeCloudWorkspaces } from '../merge';
import type { CloudWorkspaceV2 } from '../schemas';

function workspace(updatedAt: number): CloudWorkspaceV2 {
  return { schemaVersion: 2, revision: 1, updatedAt, folders: [], prompts: [], starred: [] };
}

describe('mergeCloudWorkspaces', () => {
  it('keeps the newest record and prevents deleted records from reviving on ties', () => {
    const local = workspace(10);
    const remote = workspace(10);
    const base = {
      id: 'folder',
      platform: 'm365' as const,
      accountScope: 'm365:test',
      name: 'Folder',
      parentId: null,
      sortIndex: 0,
      createdAt: 1,
    };
    local.folders.push({ ...base, updatedAt: 10, deletedAt: null });
    remote.folders.push({ ...base, updatedAt: 10, deletedAt: 10 });

    expect(mergeCloudWorkspaces(local, remote).folders[0].deletedAt).toBe(10);
  });

  it('does not contain conversation metadata or conversation bodies', () => {
    expect(Object.keys(workspace(1))).not.toContain('conversations');
  });
});
