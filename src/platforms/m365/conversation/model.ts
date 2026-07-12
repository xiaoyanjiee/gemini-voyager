import { z } from 'zod';

const SafeUrlSchema = z
  .string()
  .max(4096)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value, 'https://m365.cloud.microsoft');
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Unsupported URL protocol');

export const MessageBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('list'),
    ordered: z.boolean(),
    items: z.array(z.string()),
  }),
  z.object({
    type: z.literal('code'),
    language: z.string().max(80),
    text: z.string(),
  }),
  z.object({
    type: z.literal('table'),
    headers: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  }),
  z.object({
    type: z.literal('link'),
    text: z.string(),
    url: SafeUrlSchema,
  }),
  z.object({
    type: z.literal('image'),
    src: SafeUrlSchema,
    alt: z.string(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
  }),
]);

export const SnapshotMessageSchema = z.object({
  id: z.string().min(1).max(240),
  fingerprint: z.string().min(1).max(500),
  role: z.enum(['user', 'assistant']),
  index: z.number().int().nonnegative(),
  plainText: z.string(),
  blocks: z.array(MessageBlockSchema),
  firstSeenAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const ConversationSnapshotSchema = z.object({
  schemaVersion: z.literal(2),
  platform: z.literal('m365'),
  conversationId: z.string().min(1).max(500),
  accountScope: z.string().min(1).max(500),
  title: z.string().max(500),
  url: SafeUrlSchema,
  capturedAt: z.number().int().nonnegative(),
  messages: z.array(SnapshotMessageSchema),
});

export type MessageBlock = z.infer<typeof MessageBlockSchema>;
export type SnapshotMessage = z.infer<typeof SnapshotMessageSchema>;
export type ConversationSnapshot = z.infer<typeof ConversationSnapshotSchema>;

export function parseConversationSnapshot(input: unknown): ConversationSnapshot {
  return ConversationSnapshotSchema.parse(input);
}
