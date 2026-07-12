import type { WorkspaceV2Repository } from '@/core/v2/repositories';
import { workspaceV2Repository } from '@/core/v2/repositories';
import type {
  ConversationRecord,
  FolderRecord,
  PromptRecord,
  StarredRecord,
  WorkspaceV2,
} from '@/core/v2/schemas';

export interface M365WorkspaceView {
  folders: FolderRecord[];
  conversations: ConversationRecord[];
  prompts: PromptRecord[];
  starred: StarredRecord[];
}

function activeForAccount<T extends { accountScope: string; deletedAt: number | null }>(
  records: T[],
  accountScope: string,
): T[] {
  return records.filter(
    (record) => record.accountScope === accountScope && record.deletedAt === null,
  );
}

export class M365WorkspaceService {
  constructor(private readonly repository: WorkspaceV2Repository = workspaceV2Repository) {}

  async view(accountScope: string): Promise<M365WorkspaceView> {
    const workspace = await this.repository.get();
    return {
      folders: activeForAccount(workspace.folders, accountScope).sort(
        (left, right) => left.sortIndex - right.sortIndex || left.name.localeCompare(right.name),
      ),
      conversations: activeForAccount(workspace.conversations, accountScope),
      prompts: activeForAccount(workspace.prompts, accountScope),
      starred: activeForAccount(workspace.starred, accountScope),
    };
  }

  async createFolder(
    accountScope: string,
    name: string,
    parentId: string | null,
  ): Promise<FolderRecord> {
    const normalizedName = name.trim();
    if (!normalizedName) throw new Error('Folder name is required');
    let created: FolderRecord | null = null;
    await this.repository.update((workspace) => {
      if (parentId) {
        const parent = workspace.folders.find(
          (folder) =>
            folder.id === parentId &&
            folder.accountScope === accountScope &&
            folder.deletedAt === null,
        );
        if (!parent) throw new Error('Parent folder does not exist');
        if (parent.parentId !== null) throw new Error('Folders support at most two levels');
      }
      const now = Date.now();
      created = {
        id: crypto.randomUUID(),
        platform: 'm365',
        accountScope,
        name: normalizedName.slice(0, 160),
        parentId,
        sortIndex: workspace.folders.filter(
          (folder) => folder.accountScope === accountScope && folder.parentId === parentId,
        ).length,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      workspace.folders.push(created);
      return workspace;
    });
    if (!created) throw new Error('Unable to create folder');
    return created;
  }

  async moveConversation(
    accountScope: string,
    input: { id: string; title: string; url: string },
    folderId: string | null,
  ): Promise<void> {
    await this.repository.update((workspace) => {
      if (folderId) this.assertFolder(workspace, accountScope, folderId);
      const now = Date.now();
      const existing = workspace.conversations.find(
        (conversation) =>
          conversation.id === input.id && conversation.accountScope === accountScope,
      );
      if (existing) {
        existing.title = input.title.slice(0, 500);
        existing.url = input.url;
        existing.folderId = folderId;
        existing.updatedAt = now;
        existing.deletedAt = null;
      } else {
        workspace.conversations.push({
          id: input.id,
          platform: 'm365',
          accountScope,
          title: input.title.slice(0, 500),
          url: input.url,
          folderId,
          starred: false,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      }
      return workspace;
    });
  }

  async deleteFolder(accountScope: string, folderId: string): Promise<void> {
    await this.repository.update((workspace) => {
      const now = Date.now();
      const deletedIds = new Set([folderId]);
      workspace.folders.forEach((folder) => {
        if (folder.accountScope === accountScope && folder.parentId === folderId) {
          deletedIds.add(folder.id);
        }
      });
      workspace.folders.forEach((folder) => {
        if (folder.accountScope === accountScope && deletedIds.has(folder.id)) {
          folder.deletedAt = now;
          folder.updatedAt = now;
        }
      });
      workspace.conversations.forEach((conversation) => {
        if (
          conversation.accountScope === accountScope &&
          conversation.folderId &&
          deletedIds.has(conversation.folderId)
        ) {
          conversation.folderId = null;
          conversation.updatedAt = now;
        }
      });
      return workspace;
    });
  }

  async savePrompt(
    accountScope: string,
    input: { id?: string; title: string; text: string; tags: string[] },
  ): Promise<PromptRecord> {
    let saved: PromptRecord | null = null;
    await this.repository.update((workspace) => {
      const now = Date.now();
      const normalizedTags = [
        ...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean)),
      ].slice(0, 50);
      const existing = input.id
        ? workspace.prompts.find(
            (prompt) => prompt.id === input.id && prompt.accountScope === accountScope,
          )
        : undefined;
      if (existing) {
        existing.title = input.title.trim().slice(0, 200);
        existing.text = input.text.slice(0, 100_000);
        existing.tags = normalizedTags;
        existing.updatedAt = now;
        existing.deletedAt = null;
        saved = existing;
      } else {
        saved = {
          id: crypto.randomUUID(),
          accountScope,
          title: input.title.trim().slice(0, 200),
          text: input.text.slice(0, 100_000),
          tags: normalizedTags,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        workspace.prompts.push(saved);
      }
      return workspace;
    });
    if (!saved) throw new Error('Unable to save prompt');
    return saved;
  }

  async toggleStar(
    accountScope: string,
    conversationId: string,
    messageId: string,
    summary: string,
  ): Promise<boolean> {
    let starred = false;
    await this.repository.update((workspace) => {
      const now = Date.now();
      const existing = workspace.starred.find(
        (record) =>
          record.accountScope === accountScope &&
          record.conversationId === conversationId &&
          record.messageId === messageId,
      );
      if (existing?.deletedAt === null) {
        existing.deletedAt = now;
        existing.updatedAt = now;
        starred = false;
      } else if (existing) {
        existing.deletedAt = null;
        existing.summary = summary.slice(0, 1000);
        existing.updatedAt = now;
        starred = true;
      } else {
        workspace.starred.push({
          id: crypto.randomUUID(),
          platform: 'm365',
          accountScope,
          conversationId,
          messageId,
          summary: summary.slice(0, 1000),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        starred = true;
      }
      return workspace;
    });
    return starred;
  }

  async exportWorkspace(accountScope: string): Promise<string> {
    const view = await this.view(accountScope);
    return JSON.stringify({ schemaVersion: 2, accountScope, ...view }, null, 2);
  }

  private assertFolder(workspace: WorkspaceV2, accountScope: string, folderId: string): void {
    const folder = workspace.folders.find(
      (candidate) =>
        candidate.id === folderId &&
        candidate.accountScope === accountScope &&
        candidate.deletedAt === null,
    );
    if (!folder) throw new Error('Folder does not exist');
  }
}
