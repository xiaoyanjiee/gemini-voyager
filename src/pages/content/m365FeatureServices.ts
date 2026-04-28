import type { ChatTurn, ConversationMetadata } from '../../features/export/types/export';
import type {
  CanonicalConversation,
  CanonicalMessage,
  M365ContentItem,
  M365ImageContent,
} from './m365ConversationTypes';

export type M365ExportFormat = 'json' | 'markdown' | 'pdf' | 'image';

interface M365ExportInput {
  turns: ChatTurn[];
  metadata: ConversationMetadata;
}

interface M365DraftTurn {
  user: string;
  assistantParts: string[];
}

export interface M365TimelineIndexItem {
  id: string;
  index: number;
  role: CanonicalMessage['role'];
  summary: string;
  sourceElement: Element;
}

export class M365ExportService {
  static getExportSource(conversation: CanonicalConversation): CanonicalConversation {
    return conversation;
  }

  static buildTurns(conversation: CanonicalConversation): ChatTurn[] {
    const draftTurns: M365DraftTurn[] = [];
    let currentTurn: M365DraftTurn | null = null;

    for (const message of conversation.messages) {
      const exportText = this.toExportText(message).trim();
      if (!exportText) continue;

      if (message.role === 'user') {
        currentTurn = { user: exportText, assistantParts: [] };
        draftTurns.push(currentTurn);
        continue;
      }

      if (!currentTurn) {
        currentTurn = { user: '', assistantParts: [] };
        draftTurns.push(currentTurn);
      }

      currentTurn.assistantParts.push(exportText);
    }

    return draftTurns
      .map((turn) => ({
        user: turn.user,
        assistant: turn.assistantParts.join('\n\n'),
        starred: false,
        omitEmptySections: true,
      }))
      .filter((turn) => turn.user.length > 0 || turn.assistant.length > 0);
  }

  static buildExportInput(
    conversation: CanonicalConversation,
    title = 'M365 Copilot',
  ): M365ExportInput {
    const turns = this.buildTurns(conversation);
    return {
      turns,
      metadata: {
        url: conversation.url,
        exportedAt: conversation.timestamp,
        count: turns.length,
        title,
      },
    };
  }

  private static toExportText(message: CanonicalMessage): string {
    const parts = message.content
      .map((item) => this.contentItemToMarkdown(item))
      .filter((part): part is string => part.length > 0);

    if (parts.length === 0 && message.text.trim()) {
      parts.push(message.text.trim());
    }

    return parts.join('\n\n');
  }

  private static contentItemToMarkdown(item: M365ContentItem): string {
    if (item.kind === 'text') {
      return item.text.trim();
    }

    return this.imageToMarkdown(item);
  }

  private static imageToMarkdown(image: M365ImageContent): string {
    const url = this.resolveSafeImageUrl(image);
    if (!url) return '';

    const alt = this.escapeMarkdownAlt(image.alt || image.title || 'image');
    return `![${alt}](${url})`;
  }

  private static resolveSafeImageUrl(image: M365ImageContent): string {
    const url = (image.currentSrc || image.src).trim();
    if (!url || /[\s\p{C})]/u.test(url)) return '';

    if (url.startsWith('blob:') || url.startsWith('data:image/')) {
      return url;
    }

    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch {
      return '';
    }
  }

  private static escapeMarkdownAlt(value: string): string {
    return value
      .replace(/[\r\n]+/g, ' ')
      .replace(/[[\]\\]/g, '\\$&')
      .trim();
  }
}

export class M365TimelineService {
  static buildIndex(conversation: CanonicalConversation): M365TimelineIndexItem[] {
    return conversation.messages.map((message) => ({
      id: message.id,
      index: message.index,
      role: message.role,
      summary: this.toSummary(message.text),
      sourceElement: message.sourceElement,
    }));
  }

  private static toSummary(text: string): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
  }
}

export class M365LayoutEnhancer {
  static getLayoutTargets(conversation: CanonicalConversation): Element[] {
    return conversation.messages.map((message) => message.sourceElement);
  }
}
