import { ConversationDomIndex } from './ConversationDomIndex';
import type { ConversationDomAnchor } from './ConversationDomIndex';
import type { ConversationSnapshot, SnapshotMessage } from './model';
import { parseConversationSnapshot } from './model';

interface SessionMessage {
  value: SnapshotMessage;
  sequence: number;
}

interface ResolvedWindowMessage {
  value: SnapshotMessage;
  anchor: ConversationDomAnchor | null;
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
    const claimedIds = new Set<string>();
    const resolvedWindow: ResolvedWindowMessage[] = snapshot.messages.map((message) => {
      const incomingAnchor = domIndex?.get(message.id) ?? null;
      const persistentId = this.resolvePersistentId(message, incomingAnchor?.source, claimedIds);
      claimedIds.add(persistentId);
      return {
        value: persistentId === message.id ? message : { ...message, id: persistentId },
        anchor: incomingAnchor,
      };
    });

    resolvedWindow.forEach(({ value: message, anchor }, windowIndex) => {
      const existing = this.messages.get(message.id);
      if (existing) {
        existing.value = {
          ...message,
          firstSeenAt: Math.min(existing.value.firstSeenAt, message.firstSeenAt),
        };
      } else {
        this.messages.set(message.id, {
          value: message,
          sequence: this.sequenceForNewMessage(resolvedWindow, windowIndex),
        });
      }
      if (anchor) this.domIndex.set(message.id, anchor);
    });
    this.normalizeSequences();
    this.domIndex.pruneDisconnected();
    return this.snapshot();
  }

  private sequenceForNewMessage(
    window: ReadonlyArray<ResolvedWindowMessage>,
    index: number,
  ): number {
    const previous = window
      .slice(0, index)
      .reverse()
      .map(({ value }) => this.messages.get(value.id))
      .find((message): message is SessionMessage => message !== undefined);
    const next = window
      .slice(index + 1)
      .map(({ value }) => this.messages.get(value.id))
      .find((message): message is SessionMessage => message !== undefined);
    if (previous && next) return (previous.sequence + next.sequence) / 2;
    if (previous) return previous.sequence + 1;
    if (next) return next.sequence - 1;
    return this.nextSequence++;
  }

  private normalizeSequences(): void {
    const ordered = [...this.messages.values()].sort(
      (left, right) =>
        left.sequence - right.sequence || left.value.firstSeenAt - right.value.firstSeenAt,
    );
    ordered.forEach((message, index) => {
      message.sequence = index;
    });
    this.nextSequence = ordered.length;
  }

  private resolvePersistentId(
    message: SnapshotMessage,
    source: Element | undefined,
    claimedIds: ReadonlySet<string>,
  ): string {
    if (this.messages.has(message.id) && !claimedIds.has(message.id)) return message.id;

    if (source) {
      for (const [messageId, anchor] of this.domIndex.entries()) {
        if (anchor.source === source && !claimedIds.has(messageId)) return messageId;
      }
    }

    const fingerprintMatch = [...this.messages.entries()]
      .filter(
        ([messageId, existing]) =>
          !claimedIds.has(messageId) &&
          existing.value.role === message.role &&
          existing.value.fingerprint === message.fingerprint,
      )
      .sort(
        ([, left], [, right]) =>
          Math.abs(left.value.index - message.index) -
            Math.abs(right.value.index - message.index) || left.sequence - right.sequence,
      )[0];
    return fingerprintMatch?.[0] ?? message.id;
  }

  snapshot(): ConversationSnapshot {
    if (!this.metadata) {
      throw new Error('ConversationSession has not received a snapshot');
    }
    const messages = [...this.messages.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .map(({ value }, index) => ({ ...value, index }));
    return { ...this.metadata, messages };
  }

  reset(): void {
    this.messages.clear();
    this.domIndex.clear();
    this.metadata = null;
    this.nextSequence = 0;
  }
}
