import { describe, expect, it } from 'vitest';

import type { CanonicalConversation } from '@/pages/content/m365ConversationTypes';

import { captureM365Conversation } from '../snapshotAdapter';

describe('captureM365Conversation', () => {
  it('keeps serializable blocks separate from live DOM anchors', () => {
    const sourceElement = document.createElement('article');
    const contentElement = document.createElement('div');
    contentElement.innerHTML =
      '<p>Hello</p><pre><code class="language-ts">const x = 1;</code></pre><a href="https://example.com">Source</a>';
    sourceElement.append(contentElement);
    document.body.append(sourceElement);
    const conversation: CanonicalConversation = {
      timestamp: '2026-01-01T00:00:00.000Z',
      url: 'https://m365.cloud.microsoft/chat/abc',
      totalMessages: 1,
      userMessages: 0,
      assistantMessages: 1,
      totalImages: 0,
      rawStats: { rawUserNodeCount: 0, rawAssistantNodeCount: 1, logicalCandidateCount: 1 },
      messages: [
        {
          id: 'message-1',
          fingerprint: 'fingerprint-1',
          role: 'assistant',
          text: 'Hello',
          content: [{ kind: 'text', text: 'Hello' }],
          imageCount: 0,
          index: 0,
          visible: true,
          className: '',
          roleAttribute: '',
          sourceElement,
          contentElement,
        },
      ],
    };

    const capture = captureM365Conversation(conversation, { capturedAt: 10 });
    expect(capture.snapshot.messages[0].blocks.map(({ type }) => type)).toEqual([
      'text',
      'code',
      'link',
    ]);
    expect(JSON.stringify(capture.snapshot)).not.toContain('HTMLElement');
    expect(capture.domIndex.get('message-1')?.source).toBe(sourceElement);
  });

  it('rejects unsafe link and image protocols', () => {
    const sourceElement = document.createElement('article');
    const contentElement = document.createElement('div');
    contentElement.innerHTML = '<a href="javascript:alert(1)">Unsafe</a>';
    sourceElement.append(contentElement);
    document.body.append(sourceElement);
    const conversation = {
      timestamp: '',
      url: 'https://m365.cloud.microsoft/chat/abc',
      totalMessages: 1,
      userMessages: 1,
      assistantMessages: 0,
      totalImages: 1,
      rawStats: { rawUserNodeCount: 1, rawAssistantNodeCount: 0, logicalCandidateCount: 1 },
      messages: [
        {
          id: 'message-1',
          fingerprint: 'fingerprint-1',
          role: 'user' as const,
          text: 'Unsafe',
          content: [
            {
              kind: 'image' as const,
              src: 'data:text/html,unsafe',
              currentSrc: '',
              alt: '',
              title: '',
              width: 1,
              height: 1,
              naturalWidth: 1,
              naturalHeight: 1,
              loading: '',
              visible: true,
            },
          ],
          imageCount: 1,
          index: 0,
          visible: true,
          className: '',
          roleAttribute: '',
          sourceElement,
          contentElement,
        },
      ],
    } satisfies CanonicalConversation;

    expect(captureM365Conversation(conversation).snapshot.messages[0].blocks).toEqual([
      { type: 'text', text: 'Unsafe' },
    ]);
  });
});
