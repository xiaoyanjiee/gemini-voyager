import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CanonicalConversation, CanonicalMessage } from './m365ConversationTypes';
import { startM365Timeline, stopM365Timeline } from './m365Timeline';

const TIMELINE_ENABLED_KEY = 'gvM365TimelineEnabled';
const TIMELINE_SCROLL_MODE_KEY = 'gvM365TimelineScrollMode';

function createMessage(
  role: CanonicalMessage['role'],
  index: number,
  text: string,
): CanonicalMessage {
  const sourceElement = document.createElement('article');
  sourceElement.setAttribute('role', 'article');
  sourceElement.className = role === 'user' ? 'fai-UserMessage' : 'fai-CopilotMessage';
  sourceElement.textContent = text;
  document.body.appendChild(sourceElement);

  return {
    id: `m365:${index}:${role}`,
    fingerprint: `${role}:${text}`,
    role,
    text,
    content: [{ kind: 'text', text }],
    imageCount: 0,
    index,
    visible: true,
    className: sourceElement.className,
    roleAttribute: 'article',
    sourceElement,
    contentElement: sourceElement,
  };
}

function createConversation(messages: CanonicalMessage[]): CanonicalConversation {
  return {
    timestamp: '2026-04-29T00:00:00.000Z',
    url: 'https://m365.cloud.microsoft/chat/conversation/test',
    totalMessages: messages.length,
    userMessages: messages.filter((message) => message.role === 'user').length,
    assistantMessages: messages.filter((message) => message.role === 'assistant').length,
    totalImages: 0,
    messages,
    rawStats: {
      rawUserNodeCount: 0,
      rawAssistantNodeCount: 0,
      logicalCandidateCount: messages.length,
    },
  };
}

function startWithConversation(
  conversation: CanonicalConversation,
  scrollToElement = vi.fn(),
): ReturnType<typeof vi.fn> {
  startM365Timeline({
    extractConversation: () => conversation,
    scrollToElement,
  });
  return scrollToElement;
}

function getSyncGetMock(): ReturnType<typeof vi.fn> {
  return chrome.storage.sync.get as unknown as ReturnType<typeof vi.fn>;
}

describe('m365Timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSyncGetMock().mockImplementation(
      (defaults: Record<string, unknown>, callback?: (res: Record<string, unknown>) => void) => {
        callback?.(defaults);
      },
    );
  });

  afterEach(() => {
    stopM365Timeline();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('injects exactly one root and one style', () => {
    const conversation = createConversation([createMessage('user', 0, 'First prompt')]);

    startWithConversation(conversation);

    expect(document.querySelectorAll('#gv-m365-timeline-root')).toHaveLength(1);
    expect(document.querySelectorAll('#gv-m365-timeline-style')).toHaveLength(1);
    expect(document.querySelectorAll('#gv-m365-timeline-tooltip')).toHaveLength(1);
  });

  it('keeps multiple starts idempotent', () => {
    const conversation = createConversation([
      createMessage('user', 0, 'First prompt'),
      createMessage('assistant', 1, 'First answer'),
    ]);

    startWithConversation(conversation);
    startWithConversation(conversation);

    expect(document.querySelectorAll('#gv-m365-timeline-root')).toHaveLength(1);
    expect(document.querySelectorAll('#gv-m365-timeline-style')).toHaveLength(1);
    expect(document.querySelectorAll('[data-gv-m365-timeline-marker]')).toHaveLength(1);
    expect(chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(1);
  });

  it('does not render when stored M365 timeline setting is disabled', () => {
    getSyncGetMock().mockImplementation(
      (_defaults: Record<string, unknown>, callback?: (res: Record<string, unknown>) => void) => {
        callback?.({ [TIMELINE_ENABLED_KEY]: false, [TIMELINE_SCROLL_MODE_KEY]: 'flow' });
      },
    );

    startWithConversation(createConversation([createMessage('user', 0, 'First prompt')]));

    expect(document.querySelector('#gv-m365-timeline-root')).toBeNull();
    expect(document.querySelector('#gv-m365-timeline-style')).toBeNull();
    expect(document.querySelectorAll('[data-gv-m365-timeline-marker]')).toHaveLength(0);
  });

  it('renders markers only for user messages', () => {
    const conversation = createConversation([
      createMessage('user', 0, 'First prompt'),
      createMessage('assistant', 1, 'First answer'),
      createMessage('user', 2, 'Second prompt'),
    ]);

    startWithConversation(conversation);

    const markers = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-gv-m365-timeline-marker]'),
    );
    expect(markers).toHaveLength(2);
    expect(markers.map((marker) => marker.getAttribute('aria-label'))).toEqual([
      'First prompt',
      'Second prompt',
    ]);
  });

  it('keeps previously seen user markers when M365 virtualizes messages out of the DOM', () => {
    const first = createMessage('user', 0, 'First prompt');
    const second = createMessage('user', 1, 'Second prompt');
    const third = createMessage('user', 2, 'Third prompt');
    const fourth = createMessage('user', 3, 'Fourth prompt');
    let conversation = createConversation([first, second, third, fourth]);

    startM365Timeline({
      extractConversation: () => conversation,
      scrollToElement: vi.fn(),
    });

    first.sourceElement.remove();
    conversation = createConversation([second, third, fourth]);
    startM365Timeline({
      extractConversation: () => conversation,
      scrollToElement: vi.fn(),
    });

    const markers = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-gv-m365-timeline-marker]'),
    );

    expect(markers).toHaveLength(4);
    expect(markers.map((marker) => marker.getAttribute('aria-label'))).toEqual([
      'First prompt',
      'Second prompt',
      'Third prompt',
      'Fourth prompt',
    ]);
    expect(markers[0].dataset.gvM365TimelineVisible).toBe('false');
    expect(markers[0].classList.contains('gv-m365-timeline-marker-stale')).toBe(true);
  });

  it('does not replace cached marker titles with a disjoint virtualized window', () => {
    let conversation = createConversation([
      createMessage('user', 0, 'First prompt'),
      createMessage('user', 1, 'Second prompt'),
      createMessage('user', 2, 'Third prompt'),
      createMessage('user', 3, 'Fourth prompt'),
    ]);

    startM365Timeline({
      extractConversation: () => conversation,
      scrollToElement: vi.fn(),
    });

    document.querySelectorAll('article').forEach((element) => element.remove());
    conversation = createConversation([
      createMessage('user', 0, 'Fifth prompt'),
      createMessage('user', 1, 'Sixth prompt'),
      createMessage('user', 2, 'Seventh prompt'),
    ]);
    startM365Timeline({
      extractConversation: () => conversation,
      scrollToElement: vi.fn(),
    });

    const markers = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-gv-m365-timeline-marker]'),
    );

    expect(markers).toHaveLength(7);
    expect(markers.map((marker) => marker.getAttribute('aria-label'))).toEqual([
      'First prompt',
      'Second prompt',
      'Third prompt',
      'Fourth prompt',
      'Fifth prompt',
      'Sixth prompt',
      'Seventh prompt',
    ]);
  });

  it('scrolls to the canonical user source element when a marker is clicked', () => {
    const first = createMessage('user', 0, 'First prompt');
    const second = createMessage('user', 1, 'Second prompt');
    const conversation = createConversation([first, second]);
    const scrollToElement = startWithConversation(conversation);

    const secondMarker = document.querySelectorAll<HTMLButtonElement>(
      '[data-gv-m365-timeline-marker]',
    )[1];
    secondMarker.click();

    expect(scrollToElement).toHaveBeenCalledTimes(1);
    expect(scrollToElement).toHaveBeenCalledWith(second.sourceElement);
    expect(secondMarker.classList.contains('gv-m365-timeline-marker-active')).toBe(true);
  });

  it('uses M365 timeline scroll mode for default marker scrolling', () => {
    const first = createMessage('user', 0, 'First prompt');
    const scrollIntoView = vi.fn();
    first.sourceElement.scrollIntoView = scrollIntoView;
    const conversation = createConversation([first]);

    startM365Timeline({
      extractConversation: () => conversation,
    });

    document.querySelector<HTMLButtonElement>('[data-gv-m365-timeline-marker]')?.click();
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'start', behavior: 'smooth' });

    const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0]?.[0];
    expect(listener).toBeTypeOf('function');
    listener(
      {
        [TIMELINE_SCROLL_MODE_KEY]: {
          oldValue: 'flow',
          newValue: 'jump',
        },
      },
      'sync',
    );

    document.querySelector<HTMLButtonElement>('[data-gv-m365-timeline-marker]')?.click();
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'start', behavior: 'auto' });
  });

  it('cleans up when M365 timeline is disabled from storage changes', () => {
    startWithConversation(createConversation([createMessage('user', 0, 'First prompt')]));
    const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0]?.[0];
    expect(listener).toBeTypeOf('function');

    listener(
      {
        [TIMELINE_ENABLED_KEY]: {
          oldValue: true,
          newValue: false,
        },
      },
      'sync',
    );

    expect(document.querySelector('#gv-m365-timeline-root')).toBeNull();
    expect(document.querySelector('#gv-m365-timeline-style')).toBeNull();
    expect(document.querySelector('#gv-m365-timeline-tooltip')).toBeNull();
  });

  it('shows tooltip text from the timeline summary without DOM object leakage', () => {
    const longPrompt = `Summarize this prompt ${'with repeated words '.repeat(8)}`;
    const conversation = createConversation([createMessage('user', 0, longPrompt)]);

    startWithConversation(conversation);

    const marker = document.querySelector<HTMLButtonElement>('[data-gv-m365-timeline-marker]');
    marker?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const tooltip = document.getElementById('gv-m365-timeline-tooltip');

    expect(tooltip?.hidden).toBe(false);
    expect(tooltip?.textContent).toContain('Summarize this prompt');
    expect(tooltip?.textContent).not.toMatch(/HTML|Element|\[object/);
  });

  it('does not remove or modify the M365 export UI root', () => {
    const exportRoot = document.createElement('div');
    exportRoot.id = 'gv-m365-export-ui-root';
    exportRoot.dataset.gvM365ExportUi = 'true';
    exportRoot.textContent = 'Export JSON';
    document.body.appendChild(exportRoot);

    startWithConversation(createConversation([createMessage('user', 0, 'First prompt')]));

    expect(document.getElementById('gv-m365-export-ui-root')).toBe(exportRoot);
    expect(exportRoot.dataset.gvM365ExportUi).toBe('true');
    expect(exportRoot.textContent).toBe('Export JSON');
  });

  it('does not reference Gemini timeline selectors or storage keys in injected CSS', () => {
    startWithConversation(createConversation([createMessage('user', 0, 'First prompt')]));

    const css = document.getElementById('gv-m365-timeline-style')?.textContent || '';

    expect(css).not.toContain('gemini-timeline');
    expect(css).not.toContain('timeline-dot');
    expect(css).not.toContain('geminiTimeline');
    expect(css).not.toContain('chat-window');
  });

  it('keeps visual marker, active, stale, and tooltip names M365-only', () => {
    const first = createMessage('user', 0, 'First prompt');
    const second = createMessage('user', 1, 'Second prompt');
    second.sourceElement.remove();
    const conversation = createConversation([first, second]);

    startWithConversation(conversation);

    const marker = document.querySelector<HTMLButtonElement>('[data-gv-m365-timeline-marker]');
    marker?.click();

    const css = document.getElementById('gv-m365-timeline-style')?.textContent || '';
    expect(css).toContain('gv-m365-timeline-marker');
    expect(css).toContain('gv-m365-timeline-marker-active');
    expect(css).toContain('gv-m365-timeline-marker-stale');
    expect(css).toContain('gv-m365-timeline-tooltip');
    expect(marker?.classList.contains('gv-m365-timeline-marker-active')).toBe(true);
  });

  it('does not import Gemini timeline code or reference Gemini selectors/storage keys', () => {
    const source = readFileSync('src/pages/content/m365Timeline.ts', 'utf8');

    expect(source).not.toContain('./timeline');
    expect(source).not.toContain('timeline/index');
    expect(source).not.toContain('geminiTimeline');
    expect(source).not.toContain('gemini-timeline');
    expect(source).not.toContain('chat-window');
    expect(source).not.toContain('user-query');
    expect(source).not.toContain('model-response');
    expect(source).not.toContain('response-container');
    expect(source).not.toContain('conversation-container');
  });

  it('removes root, style, tooltip, and observer on stop', () => {
    const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect');

    startWithConversation(createConversation([createMessage('user', 0, 'First prompt')]));
    stopM365Timeline();

    expect(observeSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalled();
    expect(document.getElementById('gv-m365-timeline-root')).toBeNull();
    expect(document.getElementById('gv-m365-timeline-style')).toBeNull();
    expect(document.getElementById('gv-m365-timeline-tooltip')).toBeNull();
  });
});
