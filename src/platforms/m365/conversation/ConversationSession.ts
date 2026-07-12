import { ConversationDomIndex } from './ConversationDomIndex';
import type { ConversationSnapshot, SnapshotMessage } from './model';
import { parseConversationSnapshot } from './model';

interface SessionMessage {
  value: SnapshotMessage;
  sequence: number;
}

export class ConversationSession {
  private readonly messages = new Map<string, SessionMessage>();
  private nextSequence = 0;
  private metadata: Omit<ConversationSnapshot, 'messages'> | null = null;
  readonly domIndex = new ConversationDomIndex();

  merge(
    snapshotInput: ConversationSnapshot,
    domIndex?: ConversationDomIndex,
  ): ConversationSnapshot {
    const snapshot = parseConversationSnapshot(snapshotInput);
    if (this.metadata && this.metadata.conversationId !== snapshot.conversationId) {
      this.reset();
    }

    const { messages: _currentWindow, ...metadata } = snapshot;
    this.metadata = metadata;
    for (const message of snapshot.messages) {
      const existing = this.messages.get(message.id);
      if (existing) {
        existing.value = {
          ...message,
          firstSeenAt: Math.min(existing.value.firstSeenAt, message.firstSeenAt),
        };
      } else {
        this.messages.set(message.id, { value: message, sequence: this.nextSequence++ });
      }
    }
    if (domIndex) this.domIndex.merge(domIndex);
    return this.snapshot();
  }

  snapshot(): ConversationSnapshot {
    if (!this.metadata) {
      throw new Error('ConversationSession has not received a snapshot');
    }
    const messages = [...this.messages.values()]
      .sort(
        (left, right) =>
          left.value.index - right.value.index ||
          left.value.firstSeenAt - right.value.firstSeenAt ||
          left.sequence - right.sequence,
      )
      .map(({ value }) => value);
    return { ...this.metadata, messages };
  }

  reset(): void {
    this.messages.clear();
    this.domIndex.clear();
    this.metadata = null;
    this.nextSequence = 0;
  }
}
