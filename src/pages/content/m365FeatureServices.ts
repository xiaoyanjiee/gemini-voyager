import type { CanonicalConversation, CanonicalMessage } from './m365ConversationTypes';

export type M365ExportFormat = 'json' | 'markdown' | 'pdf' | 'image';

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
