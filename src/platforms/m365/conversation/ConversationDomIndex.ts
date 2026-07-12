export interface ConversationDomAnchor {
  source: Element;
  content: Element;
}

export class ConversationDomIndex {
  private readonly anchors = new Map<string, ConversationDomAnchor>();

  set(messageId: string, anchor: ConversationDomAnchor): void {
    this.anchors.set(messageId, anchor);
  }

  get(messageId: string): ConversationDomAnchor | null {
    const anchor = this.anchors.get(messageId);
    if (!anchor) return null;
    if (!anchor.source.isConnected || !anchor.content.isConnected) {
      this.anchors.delete(messageId);
      return null;
    }
    return anchor;
  }

  merge(other: ConversationDomIndex): void {
    for (const [messageId, anchor] of other.entries()) {
      this.anchors.set(messageId, anchor);
    }
    this.pruneDisconnected();
  }

  pruneDisconnected(): void {
    for (const [messageId, anchor] of this.anchors) {
      if (!anchor.source.isConnected || !anchor.content.isConnected) {
        this.anchors.delete(messageId);
      }
    }
  }

  clear(): void {
    this.anchors.clear();
  }

  entries(): IterableIterator<[string, ConversationDomAnchor]> {
    return this.anchors.entries();
  }
}
