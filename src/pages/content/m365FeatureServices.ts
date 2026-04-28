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

export interface M365JsonExportTurn {
  user: string;
  assistant: string;
  starred: boolean;
  omitEmptySections: boolean;
}

export interface M365JsonExportPayload {
  platform: 'm365-copilot';
  title: string;
  url: string;
  exportedAt: string;
  count: number;
  turns: M365JsonExportTurn[];
}

const DEFAULT_M365_EXPORT_TITLE = 'M365 Copilot';
const M365_JSON_PLATFORM = 'm365-copilot';
const M365_MARKDOWN_PLATFORM_LABEL = 'M365 Copilot';
const MAX_DATA_IMAGE_URL_LENGTH = 1_048_576;
const SAFE_DATA_IMAGE_URL_PATTERN = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/i;

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
    title = DEFAULT_M365_EXPORT_TITLE,
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

  static buildJsonExport(
    conversation: CanonicalConversation,
    title?: string,
  ): M365JsonExportPayload {
    const input = this.buildExportInput(conversation, title);
    return {
      platform: M365_JSON_PLATFORM,
      title: input.metadata.title || DEFAULT_M365_EXPORT_TITLE,
      url: input.metadata.url,
      exportedAt: input.metadata.exportedAt,
      count: input.metadata.count,
      turns: input.turns.map((turn) => ({
        user: turn.user,
        assistant: turn.assistant,
        starred: turn.starred,
        omitEmptySections: turn.omitEmptySections === true,
      })),
    };
  }

  static serializeJsonExport(conversation: CanonicalConversation, title?: string): string {
    return JSON.stringify(this.buildJsonExport(conversation, title), null, 2);
  }

  static buildMarkdownExport(conversation: CanonicalConversation, title?: string): string {
    const input = this.buildExportInput(conversation, title);
    const exportTitle =
      this.normalizeMarkdownMetadataValue(input.metadata.title) || DEFAULT_M365_EXPORT_TITLE;
    const lines = [
      `# ${exportTitle}`,
      '',
      `- platform: ${M365_MARKDOWN_PLATFORM_LABEL}`,
      `- url: ${this.normalizeMarkdownMetadataValue(input.metadata.url)}`,
      `- exportedAt: ${this.normalizeMarkdownMetadataValue(input.metadata.exportedAt)}`,
      `- count: ${input.metadata.count}`,
    ];

    input.turns.forEach((turn, index) => {
      const user = this.normalizeMarkdownBody(turn.user);
      const assistant = this.normalizeMarkdownBody(turn.assistant);
      lines.push('', `## Turn ${index + 1}`);

      if (user) {
        lines.push('', '### User', '', user);
      }

      if (assistant) {
        lines.push('', '### Assistant', '', assistant);
      }
    });

    return `${lines.join('\n').trimEnd()}\n`;
  }

  static serializeMarkdownExport(conversation: CanonicalConversation, title?: string): string {
    return this.buildMarkdownExport(conversation, title);
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

    if (url.startsWith('blob:')) {
      return url;
    }

    if (url.startsWith('data:image/')) {
      return this.isSafeDataImageUrl(url) ? url : '';
    }

    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch {
      return '';
    }
  }

  private static isSafeDataImageUrl(url: string): boolean {
    return url.length <= MAX_DATA_IMAGE_URL_LENGTH && SAFE_DATA_IMAGE_URL_PATTERN.test(url);
  }

  private static escapeMarkdownAlt(value: string): string {
    return value
      .replace(/[\r\n]+/g, ' ')
      .replace(/[[\]\\]/g, '\\$&')
      .trim();
  }

  private static normalizeMarkdownBody(value: string | null | undefined): string {
    return (value ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private static normalizeMarkdownMetadataValue(value: string | null | undefined): string {
    return (value ?? '').replace(/\r\n?/g, '\n').replace(/\n+/g, ' ').trim();
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
