import type { ChatTurn } from '@/features/export/types/export';
import { ExportFormat, type ExportResult } from '@/features/export/types/export';

import { messageToMarkdown } from '../conversation/messageActions';
import type { ConversationSnapshot, SnapshotMessage } from '../conversation/model';

function buildTurns(messages: SnapshotMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let current: ChatTurn | null = null;
  for (const message of messages) {
    const content = messageToMarkdown(message) || message.plainText;
    if (message.role === 'user') {
      current = { user: content, assistant: '', starred: false, omitEmptySections: true };
      turns.push(current);
    } else if (current) {
      current.assistant = [current.assistant, content].filter(Boolean).join('\n\n');
    } else {
      current = { user: '', assistant: content, starred: false, omitEmptySections: true };
      turns.push(current);
    }
  }
  return turns;
}

export class M365ExportV2Service {
  static async export(
    snapshot: ConversationSnapshot,
    format: ExportFormat,
    selectedMessageIds?: ReadonlySet<string>,
  ): Promise<ExportResult> {
    const messages = selectedMessageIds
      ? snapshot.messages.filter((message) => selectedMessageIds.has(message.id))
      : snapshot.messages;
    if (messages.length === 0) return { success: false, format, error: 'No messages selected' };

    const { ConversationExportService } = await import(
      '@/features/export/services/ConversationExportService'
    );
    return ConversationExportService.export(
      buildTurns(messages),
      {
        url: snapshot.url,
        title: snapshot.title || 'M365 Copilot',
        exportedAt: new Date(snapshot.capturedAt).toISOString(),
        count: messages.length,
      },
      { format, includeMetadata: true, embedImages: 'inline' },
    );
  }

  static formats(): readonly ExportFormat[] {
    return [ExportFormat.JSON, ExportFormat.MARKDOWN, ExportFormat.PDF, ExportFormat.IMAGE];
  }
}
