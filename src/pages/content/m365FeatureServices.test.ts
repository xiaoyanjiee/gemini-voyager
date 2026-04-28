import { describe, expect, it } from 'vitest';

import type {
  CanonicalConversation,
  CanonicalMessage,
  M365ContentItem,
  M365ImageContent,
} from './m365ConversationTypes';
import { M365ExportService } from './m365FeatureServices';

function createImage(overrides: Partial<M365ImageContent> = {}): M365ImageContent {
  return {
    kind: 'image',
    src: 'https://example.test/image.png',
    currentSrc: '',
    alt: 'Generated chart',
    title: '',
    width: 640,
    height: 480,
    naturalWidth: 640,
    naturalHeight: 480,
    loading: '',
    visible: true,
    ...overrides,
  };
}

function createMessage(
  role: CanonicalMessage['role'],
  content: M365ContentItem[],
  index: number,
): CanonicalMessage {
  const sourceElement = document.createElement('article');
  const contentElement = document.createElement('div');
  const text = content
    .filter((item): item is Extract<M365ContentItem, { kind: 'text' }> => item.kind === 'text')
    .map((item) => item.text)
    .join('\n');

  return {
    id: `m365:${index}:test`,
    fingerprint: `${role}:${index}`,
    role,
    text,
    content,
    imageCount: content.filter((item) => item.kind === 'image').length,
    index,
    visible: true,
    className: '',
    roleAttribute: 'article',
    sourceElement,
    contentElement,
  };
}

function createConversation(messages: CanonicalMessage[]): CanonicalConversation {
  return {
    timestamp: '2026-04-28T04:00:00.000Z',
    url: 'https://m365.cloud.microsoft/chat',
    totalMessages: messages.length,
    userMessages: messages.filter((message) => message.role === 'user').length,
    assistantMessages: messages.filter((message) => message.role === 'assistant').length,
    totalImages: messages.reduce((sum, message) => sum + message.imageCount, 0),
    messages,
    rawStats: {
      rawUserNodeCount: 0,
      rawAssistantNodeCount: 0,
      logicalCandidateCount: messages.length,
    },
  };
}

describe('M365ExportService', () => {
  it('pairs user messages with following assistant messages', () => {
    const conversation = createConversation([
      createMessage('user', [{ kind: 'text', text: 'First prompt' }], 0),
      createMessage('assistant', [{ kind: 'text', text: 'First answer' }], 1),
      createMessage('user', [{ kind: 'text', text: 'Second prompt' }], 2),
      createMessage('assistant', [{ kind: 'text', text: 'Second answer' }], 3),
    ]);

    const turns = M365ExportService.buildTurns(conversation);

    expect(turns).toEqual([
      {
        user: 'First prompt',
        assistant: 'First answer',
        starred: false,
        omitEmptySections: true,
      },
      {
        user: 'Second prompt',
        assistant: 'Second answer',
        starred: false,
        omitEmptySections: true,
      },
    ]);
  });

  it('merges consecutive assistant messages into the current turn', () => {
    const conversation = createConversation([
      createMessage('user', [{ kind: 'text', text: 'Prompt' }], 0),
      createMessage('assistant', [{ kind: 'text', text: 'Answer part one' }], 1),
      createMessage('assistant', [{ kind: 'text', text: 'Answer part two' }], 2),
    ]);

    const turns = M365ExportService.buildTurns(conversation);

    expect(turns).toHaveLength(1);
    expect(turns[0].assistant).toBe('Answer part one\n\nAnswer part two');
  });

  it('keeps assistant-only and user-only turns', () => {
    const conversation = createConversation([
      createMessage('assistant', [{ kind: 'text', text: 'Opening answer' }], 0),
      createMessage('user', [{ kind: 'text', text: 'Only prompt' }], 1),
      createMessage('user', [{ kind: 'text', text: 'Next prompt' }], 2),
    ]);

    const turns = M365ExportService.buildTurns(conversation);

    expect(turns).toEqual([
      {
        user: '',
        assistant: 'Opening answer',
        starred: false,
        omitEmptySections: true,
      },
      {
        user: 'Only prompt',
        assistant: '',
        starred: false,
        omitEmptySections: true,
      },
      {
        user: 'Next prompt',
        assistant: '',
        starred: false,
        omitEmptySections: true,
      },
    ]);
  });

  it('converts image-only messages to safe Markdown image lines', () => {
    const conversation = createConversation([
      createMessage('assistant', [createImage()], 0),
      createMessage(
        'assistant',
        [
          { kind: 'text', text: 'Text plus image' },
          createImage({
            currentSrc: 'blob:https://m365.cloud.microsoft/chart',
            alt: 'Chart [draft]',
          }),
        ],
        1,
      ),
    ]);

    const turns = M365ExportService.buildTurns(conversation);

    expect(turns).toHaveLength(1);
    expect(turns[0].assistant).toBe(
      '![Generated chart](https://example.test/image.png)\n\nText plus image\n\n![Chart \\[draft\\]](blob:https://m365.cloud.microsoft/chart)',
    );
  });

  it('does not expose M365 DOM elements to the Gemini export extractor', () => {
    const conversation = createConversation([
      createMessage('user', [{ kind: 'text', text: 'Prompt' }], 0),
      createMessage('assistant', [{ kind: 'text', text: 'Answer' }], 1),
    ]);

    const turns = M365ExportService.buildTurns(conversation);

    expect(turns[0].userElement).toBeUndefined();
    expect(turns[0].assistantElement).toBeUndefined();
  });

  it('builds export metadata from the canonical conversation', () => {
    const conversation = createConversation([
      createMessage('user', [{ kind: 'text', text: 'Prompt' }], 0),
      createMessage('assistant', [{ kind: 'text', text: 'Answer' }], 1),
    ]);

    const input = M365ExportService.buildExportInput(conversation, 'Quarterly chat');

    expect(input.turns).toHaveLength(1);
    expect(input.metadata).toEqual({
      url: 'https://m365.cloud.microsoft/chat',
      exportedAt: '2026-04-28T04:00:00.000Z',
      count: 1,
      title: 'Quarterly chat',
    });
  });

  it('uses the default M365 title when one is not provided', () => {
    const conversation = createConversation([
      createMessage('assistant', [{ kind: 'text', text: 'Answer' }], 0),
    ]);

    const input = M365ExportService.buildExportInput(conversation);

    expect(input.metadata.title).toBe('M365 Copilot');
  });

  it('filters unsafe image URLs from export text', () => {
    const oversizedDataUrl = `data:image/png;base64,${'a'.repeat(1_048_576)}`;
    const conversation = createConversation([
      createMessage(
        'assistant',
        [
          createImage({ src: 'javascript:alert(1)', alt: 'bad' }),
          createImage({ src: 'https://example.test/good.png', alt: 'good' }),
          createImage({ src: 'data:text/html,<svg/onload=alert(1)>', alt: 'bad data' }),
          createImage({ src: 'data:image/svg+xml;base64,PHN2Zy8+', alt: 'bad svg' }),
          createImage({ src: oversizedDataUrl, alt: 'too large' }),
          createImage({ src: 'data:image/png;base64,abc123', alt: 'safe data' }),
        ],
        0,
      ),
    ]);

    const turns = M365ExportService.buildTurns(conversation);

    expect(turns).toHaveLength(1);
    expect(turns[0].assistant).toBe(
      '![good](https://example.test/good.png)\n\n![safe data](data:image/png;base64,abc123)',
    );
  });

  it('keeps allowed base64 data image formats', () => {
    const conversation = createConversation([
      createMessage(
        'assistant',
        [
          createImage({ src: 'data:image/png;base64,cG5n', alt: 'png' }),
          createImage({ src: 'data:image/jpeg;base64,anBlZw==', alt: 'jpeg' }),
          createImage({ src: 'data:image/webp;base64,d2VicA==', alt: 'webp' }),
          createImage({ src: 'data:image/gif;base64,Z2lm', alt: 'gif' }),
        ],
        0,
      ),
    ]);

    const turns = M365ExportService.buildTurns(conversation);

    expect(turns).toHaveLength(1);
    expect(turns[0].assistant).toBe(
      [
        '![png](data:image/png;base64,cG5n)',
        '![jpeg](data:image/jpeg;base64,anBlZw==)',
        '![webp](data:image/webp;base64,d2VicA==)',
        '![gif](data:image/gif;base64,Z2lm)',
      ].join('\n\n'),
    );
  });
});
