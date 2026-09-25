import type {
  CanonicalConversation,
  CanonicalMessage,
} from '@/pages/content/m365ConversationTypes';

import { ConversationDomIndex } from './ConversationDomIndex';
import type { ConversationSnapshot, MessageBlock } from './model';

export interface M365ConversationCapture {
  snapshot: ConversationSnapshot;
  domIndex: ConversationDomIndex;
}

function textOf(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, location.href);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.href.length <= 4096 ? url.href : null;
  } catch {
    return null;
  }
}

function extractStructuredBlocks(message: CanonicalMessage): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  if (message.text) blocks.push({ type: 'text', text: message.text });

  for (const list of message.contentElement.querySelectorAll('ol, ul')) {
    const items = Array.from(list.children)
      .filter((child) => child.tagName === 'LI')
      .map((item) => textOf(item))
      .filter(Boolean);
    if (items.length > 0) blocks.push({ type: 'list', ordered: list.tagName === 'OL', items });
  }

  for (const code of message.contentElement.querySelectorAll('pre')) {
    const languageClass =
      code
        .querySelector('code')
        ?.className.match(/language-([\w-]+)/)?.[1]
        ?.slice(0, 80) ?? '';
    blocks.push({ type: 'code', language: languageClass, text: code.textContent ?? '' });
  }

  for (const table of message.contentElement.querySelectorAll('table')) {
    const headers = Array.from(table.querySelectorAll('thead th')).map((cell) => textOf(cell));
    const rows = Array.from(table.querySelectorAll('tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('th, td')).map((cell) => textOf(cell)),
    );
    blocks.push({ type: 'table', headers, rows });
  }

  for (const anchor of message.contentElement.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const url = safeUrl(anchor.getAttribute('href'));
    if (url) blocks.push({ type: 'link', text: textOf(anchor) || url, url });
  }

  for (const image of message.content) {
    if (image.kind !== 'image') continue;
    const src = safeUrl(image.currentSrc || image.src);
    if (!src) continue;
    blocks.push({
      type: 'image',
      src,
      alt: image.alt,
      width: Math.max(0, image.naturalWidth || image.width),
      height: Math.max(0, image.naturalHeight || image.height),
    });
  }
  return blocks;
}

function conversationIdFromUrl(urlValue: string): string {
  try {
    const url = new URL(urlValue);
    return url.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return urlValue;
  }
}

export function captureM365Conversation(
  conversation: CanonicalConversation,
  options: { accountScope?: string; title?: string; capturedAt?: number } = {},
): M365ConversationCapture {
  const capturedAt = options.capturedAt ?? Date.now();
  const domIndex = new ConversationDomIndex();
  const messages = conversation.messages.map((message) => {
    domIndex.set(message.id, { source: message.sourceElement, content: message.contentElement });
    return {
      id: message.id,
      fingerprint: message.fingerprint,
      role: message.role,
      index: message.index,
      plainText: message.text,
      blocks: extractStructuredBlocks(message),
      firstSeenAt: capturedAt,
      updatedAt: capturedAt,
    };
  });

  return {
    snapshot: {
      schemaVersion: 2,
      platform: 'm365',
      conversationId: conversationIdFromUrl(conversation.url),
      accountScope: options.accountScope ?? 'm365:unknown',
      title: (options.title ?? document.title).slice(0, 500),
      url: conversation.url,
      capturedAt,
      messages,
    },
    domIndex,
  };
}
