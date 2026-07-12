import { z } from 'zod';

export const PLATFORM_IDS = ['m365', 'gemini', 'aistudio', 'custom'] as const;
export const PlatformIdSchema = z.enum(PLATFORM_IDS);
export type PlatformId = z.infer<typeof PlatformIdSchema>;

export const CloudProviderIdSchema = z.enum(['google-drive', 'onedrive']);
export type CloudProviderId = z.infer<typeof CloudProviderIdSchema>;

const TimelineSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  scrollMode: z.enum(['jump', 'flow']).default('flow'),
  showUserMessages: z.boolean().default(true),
  showAssistantMessages: z.boolean().default(false),
});

const DEFAULT_TIMELINE_SETTINGS = {
  enabled: true,
  scrollMode: 'flow' as const,
  showUserMessages: true,
  showAssistantMessages: false,
};

const PlatformSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  chatWidthPercent: z.number().int().min(30).max(100).default(75),
  inputCollapseEnabled: z.boolean().default(false),
  timeline: TimelineSettingsSchema.default(DEFAULT_TIMELINE_SETTINGS),
});

const DEFAULT_PLATFORM_SETTINGS = {
  enabled: true,
  chatWidthPercent: 75,
  inputCollapseEnabled: false,
  timeline: DEFAULT_TIMELINE_SETTINGS,
};

export const SettingsV2Schema = z.object({
  schemaVersion: z.literal(2),
  activeCloudProvider: CloudProviderIdSchema.nullable().default(null),
  language: z.string().min(2).max(16).default('en'),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  platforms: z.object({
    m365: PlatformSettingsSchema.default(DEFAULT_PLATFORM_SETTINGS),
    gemini: PlatformSettingsSchema.default(DEFAULT_PLATFORM_SETTINGS),
    aistudio: PlatformSettingsSchema.default(DEFAULT_PLATFORM_SETTINGS),
    custom: PlatformSettingsSchema.default(DEFAULT_PLATFORM_SETTINGS),
  }),
});

export type SettingsV2 = z.infer<typeof SettingsV2Schema>;

const TimestampSchema = z.number().int().nonnegative();
const EntityIdSchema = z.string().trim().min(1).max(160);
const AccountScopeSchema = z.string().trim().min(1).max(500);
const SafeWebUrlSchema = z
  .string()
  .trim()
  .max(4096)
  .refine((value) => {
    if (!value) return true;
    if (value.startsWith('/')) return !value.startsWith('//');
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'URL must use http, https, or an absolute site path');

export const FolderRecordSchema = z.object({
  id: EntityIdSchema,
  platform: PlatformIdSchema,
  accountScope: AccountScopeSchema,
  name: z.string().trim().min(1).max(160),
  parentId: EntityIdSchema.nullable(),
  sortIndex: z.number().int(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  deletedAt: TimestampSchema.nullable().default(null),
});

export const ConversationRecordSchema = z.object({
  id: EntityIdSchema,
  platform: PlatformIdSchema,
  accountScope: AccountScopeSchema,
  title: z.string().trim().max(500),
  url: SafeWebUrlSchema,
  folderId: EntityIdSchema.nullable(),
  starred: z.boolean().default(false),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  deletedAt: TimestampSchema.nullable().default(null),
});

export const PromptRecordSchema = z.object({
  id: EntityIdSchema,
  accountScope: AccountScopeSchema,
  title: z.string().trim().max(200),
  text: z.string().max(100_000),
  tags: z.array(z.string().trim().min(1).max(64)).max(50),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  deletedAt: TimestampSchema.nullable().default(null),
});

export const StarredRecordSchema = z.object({
  id: EntityIdSchema,
  platform: PlatformIdSchema,
  accountScope: AccountScopeSchema,
  conversationId: EntityIdSchema,
  messageId: EntityIdSchema,
  summary: z.string().max(1000),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  deletedAt: TimestampSchema.nullable().default(null),
});

export const WorkspaceV2Schema = z.object({
  schemaVersion: z.literal(2),
  workspaceId: EntityIdSchema,
  revision: z.number().int().nonnegative(),
  updatedAt: TimestampSchema,
  folders: z.array(FolderRecordSchema),
  conversations: z.array(ConversationRecordSchema),
  prompts: z.array(PromptRecordSchema),
  starred: z.array(StarredRecordSchema),
});

export type WorkspaceV2 = z.infer<typeof WorkspaceV2Schema>;
export type FolderRecord = z.infer<typeof FolderRecordSchema>;
export type ConversationRecord = z.infer<typeof ConversationRecordSchema>;
export type PromptRecord = z.infer<typeof PromptRecordSchema>;
export type StarredRecord = z.infer<typeof StarredRecordSchema>;

export function createDefaultSettingsV2(): SettingsV2 {
  return SettingsV2Schema.parse({
    schemaVersion: 2,
    platforms: {
      m365: DEFAULT_PLATFORM_SETTINGS,
      gemini: DEFAULT_PLATFORM_SETTINGS,
      aistudio: DEFAULT_PLATFORM_SETTINGS,
      custom: DEFAULT_PLATFORM_SETTINGS,
    },
  });
}

export function createEmptyWorkspaceV2(workspaceId: string = crypto.randomUUID()): WorkspaceV2 {
  return {
    schemaVersion: 2,
    workspaceId,
    revision: 0,
    updatedAt: Date.now(),
    folders: [],
    conversations: [],
    prompts: [],
    starred: [],
  };
}
