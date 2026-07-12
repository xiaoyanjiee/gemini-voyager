import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type WorkspaceV2, createEmptyWorkspaceV2 } from '@/core/v2/schemas';

import { M365WorkspaceService } from '../M365WorkspaceService';

describe('M365WorkspaceService', () => {
  let workspace: WorkspaceV2;
  const repository = {
    get: vi.fn(async () => structuredClone(workspace)),
    set: vi.fn(),
    update: vi.fn(async (mutator: (value: WorkspaceV2) => WorkspaceV2) => {
      workspace = mutator(structuredClone(workspace));
      return workspace;
    }),
  };

  beforeEach(() => {
    workspace = createEmptyWorkspaceV2('test');
    vi.clearAllMocks();
  });

  it('enforces a two-level folder hierarchy', async () => {
    const service = new M365WorkspaceService(repository);
    const root = await service.createFolder('m365:a', 'Root', null);
    const child = await service.createFolder('m365:a', 'Child', root.id);

    await expect(service.createFolder('m365:a', 'Too deep', child.id)).rejects.toThrow(
      'at most two levels',
    );
  });

  it('isolates workspace records by account scope', async () => {
    const service = new M365WorkspaceService(repository);
    await service.createFolder('m365:a', 'A', null);
    await service.createFolder('m365:b', 'B', null);

    expect((await service.view('m365:a')).folders.map(({ name }) => name)).toEqual(['A']);
  });

  it('uses tombstones and unfiles conversations when deleting folders', async () => {
    const service = new M365WorkspaceService(repository);
    const folder = await service.createFolder('m365:a', 'A', null);
    await service.moveConversation(
      'm365:a',
      { id: 'conversation', title: 'Chat', url: 'https://m365.cloud.microsoft/chat/1' },
      folder.id,
    );
    await service.deleteFolder('m365:a', folder.id);

    expect(workspace.folders[0].deletedAt).not.toBeNull();
    expect(workspace.conversations[0].folderId).toBeNull();
  });
});
