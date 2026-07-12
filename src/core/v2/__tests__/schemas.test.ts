import { describe, expect, it } from 'vitest';

import {
  ConversationRecordSchema,
  SettingsV2Schema,
  WorkspaceV2Schema,
  createDefaultSettingsV2,
  createEmptyWorkspaceV2,
} from '../schemas';

describe('V2 schemas', () => {
  it('creates complete default settings', () => {
    const settings = createDefaultSettingsV2();
    expect(SettingsV2Schema.parse(settings).platforms.m365.chatWidthPercent).toBe(75);
    expect(SettingsV2Schema.parse(settings).platforms.m365.dockPosition).toBe('right');
  });

  it('rejects executable conversation URLs', () => {
    expect(() =>
      ConversationRecordSchema.parse({
        id: 'conversation-1',
        platform: 'm365',
        accountScope: 'm365:test',
        title: 'Unsafe',
        url: 'javascript:alert(1)',
        folderId: null,
        createdAt: 1,
        updatedAt: 1,
      }),
    ).toThrow();
  });

  it('accepts safe relative and https conversation URLs', () => {
    const base = {
      id: 'conversation-1',
      platform: 'm365' as const,
      accountScope: 'm365:test',
      title: 'Safe',
      folderId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(ConversationRecordSchema.parse({ ...base, url: '/chat/conversation/1' }).url).toBe(
      '/chat/conversation/1',
    );
    expect(
      ConversationRecordSchema.parse({ ...base, url: 'https://m365.cloud.microsoft/chat' }).url,
    ).toContain('https://');
  });

  it('creates a valid empty workspace', () => {
    expect(WorkspaceV2Schema.parse(createEmptyWorkspaceV2('workspace-test')).revision).toBe(0);
  });
});
