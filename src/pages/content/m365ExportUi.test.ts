import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  CanonicalConversation,
  CanonicalMessage,
  M365ContentItem,
} from './m365ConversationTypes';
import {
  buildM365ExportFilename,
  runM365ExportAction,
  sanitizeM365ExportFilenameBase,
  startM365ExportUi,
} from './m365ExportUi';
import { M365ExportService } from './m365FeatureServices';

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
    imageCount: 0,
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
    timestamp: '2026-04-29T01:02:03.004Z',
    url: 'https://m365.cloud.microsoft/chat',
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

function createExportableConversation(): CanonicalConversation {
  return createConversation([
    createMessage('user', [{ kind: 'text', text: 'Prompt' }], 0),
    createMessage('assistant', [{ kind: 'text', text: 'Answer' }], 1),
  ]);
}

describe('M365 minimal export UI', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('calls the JSON serializer and downloads JSON content', () => {
    const conversation = createExportableConversation();
    const serializeJsonExport = vi.fn(() => '{"ok":true}');
    const serializeMarkdownExport = vi.fn(() => '# unused');
    const downloadText = vi.fn();
    const showStatus = vi.fn();

    const result = runM365ExportAction('json', {
      extractConversation: () => conversation,
      buildTurns: M365ExportService.buildTurns.bind(M365ExportService),
      serializeJsonExport,
      serializeMarkdownExport,
      downloadText,
      showStatus,
      getTitle: () => 'Launch: Chat',
      now: () => new Date('2026-04-29T01:02:03.004Z'),
    });

    expect(result.status).toBe('downloaded');
    expect(serializeJsonExport).toHaveBeenCalledWith(conversation, 'Launch Chat');
    expect(serializeMarkdownExport).not.toHaveBeenCalled();
    expect(downloadText).toHaveBeenCalledWith(
      '{"ok":true}',
      'Launch Chat-2026-04-29T01-02-03-004Z.json',
      'application/json;charset=utf-8',
    );
    expect(showStatus).toHaveBeenCalledWith('Exported JSON.', 'success');
  });

  it('calls the Markdown serializer and downloads Markdown content', () => {
    const conversation = createExportableConversation();
    const serializeJsonExport = vi.fn(() => '{"unused":true}');
    const serializeMarkdownExport = vi.fn(() => '# Chat');
    const downloadText = vi.fn();

    const result = runM365ExportAction('markdown', {
      extractConversation: () => conversation,
      buildTurns: M365ExportService.buildTurns.bind(M365ExportService),
      serializeJsonExport,
      serializeMarkdownExport,
      downloadText,
      showStatus: vi.fn(),
      getTitle: () => 'M365 Copilot',
      now: () => new Date('2026-04-29T01:02:03.004Z'),
    });

    expect(result.status).toBe('downloaded');
    expect(serializeMarkdownExport).toHaveBeenCalledWith(conversation, 'M365 Copilot');
    expect(serializeJsonExport).not.toHaveBeenCalled();
    expect(downloadText).toHaveBeenCalledWith(
      '# Chat',
      'M365 Copilot-2026-04-29T01-02-03-004Z.md',
      'text/markdown;charset=utf-8',
    );
  });

  it('does not download or serialize an empty conversation', () => {
    const conversation = createConversation([]);
    const serializeJsonExport = vi.fn(() => '{"empty":true}');
    const downloadText = vi.fn();
    const showStatus = vi.fn();

    const result = runM365ExportAction('json', {
      extractConversation: () => conversation,
      buildTurns: M365ExportService.buildTurns.bind(M365ExportService),
      serializeJsonExport,
      downloadText,
      showStatus,
    });

    expect(result).toEqual({ status: 'empty', format: 'json' });
    expect(serializeJsonExport).not.toHaveBeenCalled();
    expect(downloadText).not.toHaveBeenCalled();
    expect(showStatus).toHaveBeenCalledWith('No exportable M365 messages found.', 'info');
  });

  it('sanitizes filenames and appends an ISO datetime suffix', () => {
    expect(sanitizeM365ExportFilenameBase('  Launch:/\\*?"<>| Chat.  ')).toBe('Launch Chat');
    expect(sanitizeM365ExportFilenameBase('CON')).toBe('M365 Copilot');
    expect(sanitizeM365ExportFilenameBase('')).toBe('M365 Copilot');
    expect(
      buildM365ExportFilename(
        '  Launch:/\\*?"<>| Chat.  ',
        'json',
        new Date('2026-04-29T01:02:03.004Z'),
      ),
    ).toBe('Launch Chat-2026-04-29T01-02-03-004Z.json');
  });

  it('passes the canonical conversation into serializers without Gemini DOM element turns', () => {
    const conversation = createExportableConversation();
    const buildTurns = vi.fn((input: CanonicalConversation) => {
      const turns = M365ExportService.buildTurns(input);
      expect(turns[0].userElement).toBeUndefined();
      expect(turns[0].assistantElement).toBeUndefined();
      return turns;
    });
    const serializeJsonExport = vi.fn(() => '{"ok":true}');

    runM365ExportAction('json', {
      extractConversation: () => conversation,
      buildTurns,
      serializeJsonExport,
      downloadText: vi.fn(),
      showStatus: vi.fn(),
    });

    expect(buildTurns).toHaveBeenCalledWith(conversation);
    expect(serializeJsonExport).toHaveBeenCalledWith(conversation, 'M365 Copilot');
  });

  it('uses a stable default title instead of the M365 page prompt title', () => {
    document.title = 'User prompt should not become export title';
    const conversation = createExportableConversation();
    const downloadText = vi.fn();

    const result = runM365ExportAction('markdown', {
      extractConversation: () => conversation,
      buildTurns: M365ExportService.buildTurns.bind(M365ExportService),
      downloadText,
      showStatus: vi.fn(),
      now: () => new Date('2026-04-29T01:02:03.004Z'),
    });

    expect(result.status).toBe('downloaded');
    expect(result.content).toContain('# M365 Copilot');
    expect(result.content).not.toContain('User prompt should not become export title');
    expect(downloadText).toHaveBeenCalledWith(
      expect.stringContaining('# M365 Copilot'),
      'M365 Copilot-2026-04-29T01-02-03-004Z.md',
      'text/markdown;charset=utf-8',
    );
  });

  it('downloads serialized content without DOM leakage markers', () => {
    const conversation = createExportableConversation();
    const downloadText = vi.fn();

    const result = runM365ExportAction('json', {
      extractConversation: () => conversation,
      buildTurns: M365ExportService.buildTurns.bind(M365ExportService),
      downloadText,
      showStatus: vi.fn(),
    });

    const downloadedContent = String(downloadText.mock.calls[0]?.[0] ?? '');
    expect(result.status).toBe('downloaded');
    expect(downloadedContent).not.toContain('sourceElement');
    expect(downloadedContent).not.toContain('contentElement');
    expect(downloadedContent).not.toContain('userElement');
    expect(downloadedContent).not.toContain('assistantElement');
    expect(downloadedContent).not.toContain('HTMLElement');
    expect(downloadedContent).not.toContain('Node');
  });

  it('injects one M365-only UI root and style idempotently', () => {
    startM365ExportUi();
    startM365ExportUi();

    expect(document.querySelectorAll('[data-gv-m365-export-ui]')).toHaveLength(1);
    expect(document.querySelectorAll('#gv-m365-export-ui-style')).toHaveLength(1);
    expect(document.querySelectorAll('[data-gv-m365-export-format="json"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-gv-m365-export-format="markdown"]')).toHaveLength(1);
    expect(document.querySelector('.gv-logo-dropdown-wrapper')).toBeNull();
    expect(document.querySelector('.gv-export-dialog')).toBeNull();
  });
});
