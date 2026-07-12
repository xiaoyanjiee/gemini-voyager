import { z } from 'zod';

import { FolderRecordSchema, PromptRecordSchema, StarredRecordSchema } from '../schemas';

export const CloudWorkspaceV2Schema = z.object({
  schemaVersion: z.literal(2),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  folders: z.array(FolderRecordSchema),
  prompts: z.array(PromptRecordSchema),
  starred: z.array(StarredRecordSchema),
});

export type CloudWorkspaceV2 = z.infer<typeof CloudWorkspaceV2Schema>;

export const OAuthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
});
