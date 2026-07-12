import { z } from 'zod';

import type { FolderData } from '@/core/types/folder';

const SafeStoredUrlSchema = z
  .string()
  .trim()
  .max(4096)
  .refine((value) => {
    if (!value) return true;
    if (value.startsWith('/')) return !value.startsWith('//');
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Conversation URL must use http, https, or an absolute site path');

const FolderSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(160),
    parentId: z.string().trim().min(1).max(160).nullable(),
    isExpanded: z.boolean(),
    pinned: z.boolean().optional(),
    color: z.string().trim().max(64).optional(),
    sortIndex: z.number().int().optional(),
    createdAt: z.number().finite().nonnegative(),
    updatedAt: z.number().finite().nonnegative(),
  })
  .strict();

const ConversationSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(512),
    title: z.string().trim().max(1000),
    url: SafeStoredUrlSchema,
    addedAt: z.number().finite().nonnegative(),
    lastOpenedAt: z.number().finite().nonnegative().optional(),
    updatedAt: z.number().finite().nonnegative().optional(),
    isGem: z.boolean().optional(),
    gemId: z.string().trim().max(512).optional(),
    starred: z.boolean().optional(),
    customTitle: z.boolean().optional(),
    sortIndex: z.number().int().optional(),
  })
  .strict();

const FolderDataSchema = z
  .object({
    folders: z.array(FolderSchema).max(10_000),
    folderContents: z.record(z.string().max(160), z.array(ConversationSchema).max(100_000)),
  })
  .strict()
  .superRefine((data, context) => {
    const ids = new Set(data.folders.map((folder) => folder.id));
    if (ids.size !== data.folders.length) {
      context.addIssue({ code: 'custom', message: 'Folder IDs must be unique' });
    }
    for (const folder of data.folders) {
      if (folder.parentId && !ids.has(folder.parentId)) {
        context.addIssue({ code: 'custom', message: `Unknown parent folder: ${folder.parentId}` });
      }
    }
    for (const key of Object.keys(data.folderContents)) {
      if (key !== '__uncategorized__' && key !== '__root_conversations__' && !ids.has(key)) {
        context.addIssue({ code: 'custom', message: `Unknown folder content key: ${key}` });
      }
    }
  });

export function parseFolderData(value: unknown): FolderData {
  return FolderDataSchema.parse(value) as FolderData;
}

export function safeParseFolderData(
  value: unknown,
): { success: true; data: FolderData } | { success: false; error: z.ZodError } {
  const result = FolderDataSchema.safeParse(value);
  return result.success
    ? { success: true, data: result.data as FolderData }
    : { success: false, error: result.error };
}
