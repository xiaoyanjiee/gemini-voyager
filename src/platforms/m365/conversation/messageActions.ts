import type { MessageBlock, SnapshotMessage } from './model';

const M365_EDITOR_SELECTORS = [
  '[contenteditable="true"][role="textbox"]',
  'textarea',
  '[contenteditable="true"]',
] as const;

function blockToMarkdown(block: MessageBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'list':
      return block.items
        .map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${item}`)
        .join('\n');
    case 'code':
      return `\`\`\`${block.language}\n${block.text}\n\`\`\``;
    case 'table': {
      const width = Math.max(block.headers.length, ...block.rows.map((row) => row.length), 1);
      const headers = Array.from({ length: width }, (_, index) => block.headers[index] ?? '');
      const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
      block.rows.forEach((row) =>
        lines.push(`| ${headers.map((_, index) => row[index] ?? '').join(' | ')} |`),
      );
      return lines.join('\n');
    }
    case 'link':
      return `[${block.text.replace(/[[\]]/g, '\\$&')}](${block.url})`;
    case 'image':
      return `![${block.alt.replace(/[[\]]/g, '\\$&')}](${block.src})`;
  }
}

export function messageToMarkdown(message: SnapshotMessage): string {
  return message.blocks.map(blockToMarkdown).filter(Boolean).join('\n\n').trim();
}

export function containsFormula(message: SnapshotMessage): boolean {
  return /\$[^$\n]+\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\\begin\{[^}]+\}/.test(message.plainText);
}

export async function copyMessage(
  message: SnapshotMessage,
  format: 'plain' | 'markdown' | 'formula',
): Promise<void> {
  const text = format === 'plain' ? message.plainText : messageToMarkdown(message);
  if (format === 'formula' && !containsFormula(message)) {
    throw new Error('Message does not contain a recognized formula');
  }
  await navigator.clipboard.writeText(text);
}

export function insertIntoM365Editor(text: string, doc: Document = document): boolean {
  const editor = M365_EDITOR_SELECTORS.map((selector) =>
    doc.querySelector<HTMLElement>(selector),
  ).find((candidate) => candidate !== null);
  if (!editor) return false;

  editor.focus();
  if (editor instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(editor, `${editor.value}${editor.value ? '\n' : ''}${text}`);
  } else {
    const selection = doc.getSelection();
    if (selection && editor.contains(selection.anchorNode)) {
      selection.deleteFromDocument();
      selection.getRangeAt(0).insertNode(doc.createTextNode(text));
      selection.collapseToEnd();
    } else {
      editor.append(doc.createTextNode(`${editor.textContent ? '\n' : ''}${text}`));
    }
  }
  editor.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
  );
  return true;
}

export function quoteMessageInM365Editor(
  message: SnapshotMessage,
  doc: Document = document,
): boolean {
  const quote = message.plainText
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return insertIntoM365Editor(quote, doc);
}
