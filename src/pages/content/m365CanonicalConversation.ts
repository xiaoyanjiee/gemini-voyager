import type {
  CanonicalConversation,
  CanonicalMessage,
  M365ContentItem,
  M365ImageContent,
  M365MessageRole,
  M365RawConversation,
  M365RawMessageCandidate,
} from './m365ConversationTypes';

const EMPTY_USER_LABEL_PATTERN = /^you\s+said\s*:?\s*/i;

export class CanonicalConversationBuilder {
  static build(raw: M365RawConversation): CanonicalConversation {
    const messages = this.dedupeAdjacentMessages(
      raw.candidates
        .slice()
        .sort((a, b) => this.compareDomOrder(a.element, b.element))
        .map((candidate) => this.createMessage(candidate))
        .filter((message): message is CanonicalMessage => message !== null),
    );
    const totalImages = messages.reduce((sum, message) => sum + message.imageCount, 0);

    return {
      timestamp: raw.timestamp,
      url: raw.url,
      totalMessages: messages.length,
      userMessages: messages.filter((message) => message.role === 'user').length,
      assistantMessages: messages.filter((message) => message.role === 'assistant').length,
      totalImages,
      messages,
      rawStats: {
        rawUserNodeCount: raw.rawUserNodeCount,
        rawAssistantNodeCount: raw.rawAssistantNodeCount,
        logicalCandidateCount: raw.logicalCandidateCount,
      },
    };
  }

  private static createMessage(candidate: M365RawMessageCandidate): CanonicalMessage | null {
    const text = this.cleanMessageText(candidate.rawText, candidate.role);
    const content = this.buildContent(text, candidate.images);
    if (content.length === 0) return null;

    const imageCount = candidate.images.length;
    const fingerprint = this.createFingerprint(candidate.role, text, candidate.images);

    return {
      id: '',
      fingerprint,
      role: candidate.role,
      text,
      content,
      imageCount,
      index: 0,
      visible: candidate.visible,
      className: candidate.className,
      roleAttribute: candidate.roleAttribute,
      sourceElement: candidate.element,
      contentElement: candidate.contentElement,
    };
  }

  private static buildContent(text: string, images: M365ImageContent[]): M365ContentItem[] {
    const content: M365ContentItem[] = [];
    if (text) {
      content.push({ kind: 'text', text });
    }
    content.push(...images);
    return content;
  }

  private static cleanMessageText(text: string, role: M365MessageRole): string {
    const normalized = this.normalizeWhitespace(text);
    if (role !== 'user') return normalized;
    return this.normalizeWhitespace(normalized.replace(EMPTY_USER_LABEL_PATTERN, ''));
  }

  private static createFingerprint(
    role: M365MessageRole,
    text: string,
    images: M365ImageContent[],
  ): string {
    const imageKeys = images.map((item) => item.currentSrc || item.src || item.alt).join('|');
    return `${role}\n${this.normalizeWhitespace(text).toLowerCase()}\n${imageKeys}`;
  }

  private static dedupeAdjacentMessages(messages: CanonicalMessage[]): CanonicalMessage[] {
    const deduped: CanonicalMessage[] = [];
    let previousFingerprint = '';

    for (const message of messages) {
      if (message.fingerprint === previousFingerprint) continue;
      deduped.push(message);
      previousFingerprint = message.fingerprint;
    }

    return deduped.map((message, index) => ({
      ...message,
      id: `m365:${index}:${this.hashString(message.fingerprint)}`,
      index,
    }));
  }

  private static compareDomOrder(a: Element, b: Element): number {
    const position = a.compareDocumentPosition(b);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }

  private static normalizeWhitespace(text: string): string {
    return text
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  private static hashString(input: string): string {
    let hash = 2166136261 >>> 0;
    for (let index = 0; index < input.length; index++) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
}
