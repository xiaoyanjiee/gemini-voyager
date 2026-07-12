import { describe, expect, it } from 'vitest';

import { ConversationDomIndex } from '../ConversationDomIndex';
import { ConversationSession } from '../ConversationSession';
import type { ConversationSnapshot } from '../model';

function snapshot(
  conversationId: string,
  messages: Array<{ id: string; index: number; text: string; fingerprint?: string }>,
): ConversationSnapshot {
  return {
    schemaVersion: 2,
    platform: 'm365',
    conversationId,
    accountScope: 'm365:test',
    title: 'Test',
    url: `https://m365.cloud.microsoft/chat/${conversationId}`,
    capturedAt: 100,
    messages: messages.map(({ id, index, text, fingerprint }) => ({
      id,
      fingerprint: fingerprint ?? `fp-${id}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      index,
      plainText: text,
      blocks: [{ type: 'text', text }],
      firstSeenAt: 100,
      updatedAt: 100,
    })),
  };
}

describe('ConversationSession', () => {
  it('merges virtualized windows and keeps stable order', () => {
    const session = new ConversationSession();
    session.merge(snapshot('one', [{ id: 'b', index: 1, text: 'second' }]));
    const result = session.merge(
      snapshot('one', [
        { id: 'a', index: 0, text: 'first' },
        { id: 'b', index: 1, text: 'second updated' },
      ]),
    );

    expect(result.messages.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(result.messages[1].plainText).toBe('second updated');
  });

  it('resets cached messages when the conversation changes', () => {
    const session = new ConversationSession();
    session.merge(snapshot('one', [{ id: 'a', index: 0, text: 'old' }]));

    expect(
      session.merge(snapshot('two', [{ id: 'b', index: 0, text: 'new' }])).messages,
    ).toHaveLength(1);
  });

  it('replaces a streaming message when the same DOM anchor gets a new fingerprint', () => {
    const session = new ConversationSession();
    const source = document.createElement('article');
    const content = document.createElement('div');
    source.append(content);
    document.body.append(source);

    const partialIndex = new ConversationDomIndex();
    partialIndex.set('partial', { source, content });
    session.merge(
      snapshot('one', [{ id: 'partial', index: 1, text: 'E', fingerprint: 'assistant-e' }]),
      partialIndex,
    );

    const finalIndex = new ConversationDomIndex();
    finalIndex.set('final', { source, content });
    const result = session.merge(
      snapshot('one', [{ id: 'final', index: 1, text: 'E=mc²', fingerprint: 'assistant-e-mc2' }]),
      finalIndex,
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ id: 'partial', plainText: 'E=mc²' });
    expect(session.domIndex.get('partial')?.source).toBe(source);
  });

  it('deduplicates virtualized messages whose window-relative ids changed', () => {
    const session = new ConversationSession();
    session.merge(
      snapshot('one', [
        { id: 'window-a', index: 0, text: 'same', fingerprint: 'stable-fingerprint' },
      ]),
    );

    const result = session.merge(
      snapshot('one', [
        { id: 'window-b', index: 4, text: 'same', fingerprint: 'stable-fingerprint' },
      ]),
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ id: 'window-a', index: 0 });
  });

  it('drops disconnected DOM anchors', () => {
    const index = new ConversationDomIndex();
    const source = document.createElement('article');
    const content = document.createElement('div');
    source.append(content);
    document.body.append(source);
    index.set('message', { source, content });
    expect(index.get('message')).not.toBeNull();

    source.remove();
    expect(index.get('message')).toBeNull();
  });
});
