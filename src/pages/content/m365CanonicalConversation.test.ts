import { describe, expect, it } from 'vitest';

import { parseConversationSnapshot } from '@/platforms/m365/conversation/model';
import { captureM365Conversation } from '@/platforms/m365/conversation/snapshotAdapter';

import { CanonicalConversationBuilder } from './m365CanonicalConversation';
import type { M365RawMessageCandidate } from './m365ConversationTypes';

function candidate(role: 'user' | 'assistant', rawText: string): M365RawMessageCandidate {
  const element = document.createElement('article');
  const contentElement = document.createElement('div');
  contentElement.textContent = rawText;
  element.append(contentElement);
  document.body.append(element);
  return {
    role,
    element,
    contentElement,
    rawText,
    images: [],
    ordinal: 0,
    visible: true,
    className: '',
    roleAttribute: '',
  };
}

function build(candidates: M365RawMessageCandidate[]) {
  return CanonicalConversationBuilder.build({
    timestamp: '2026-01-01T00:00:00.000Z',
    url: 'https://m365.cloud.microsoft/chat/conversation/test',
    rawUserNodeCount: candidates.filter((c) => c.role === 'user').length,
    rawAssistantNodeCount: candidates.filter((c) => c.role === 'assistant').length,
    logicalCandidateCount: candidates.length,
    candidates,
  });
}

describe('CanonicalConversationBuilder', () => {
  it('produces a bounded fingerprint and valid snapshot for very long messages', () => {
    const canonical = build([
      candidate('user', 'Short question'),
      candidate('assistant', 'Long answer '.repeat(10_000)),
    ]);

    expect(canonical.messages).toHaveLength(2);
    for (const message of canonical.messages) {
      expect(message.fingerprint.length).toBeLessThanOrEqual(500);
    }

    const { snapshot } = captureM365Conversation(canonical, {
      title: 'T'.repeat(1_000),
    });
    expect(() => parseConversationSnapshot(snapshot)).not.toThrow();
    expect(snapshot.title.length).toBeLessThanOrEqual(500);
  });

  it('still dedupes adjacent identical messages with hashed fingerprints', () => {
    const canonical = build([
      candidate('assistant', 'same answer '.repeat(1_000)),
      candidate('assistant', 'same answer '.repeat(1_000)),
    ]);
    expect(canonical.messages).toHaveLength(1);
  });
});
