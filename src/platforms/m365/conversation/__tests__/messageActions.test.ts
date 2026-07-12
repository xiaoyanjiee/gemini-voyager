import { describe, expect, it } from 'vitest';

import { containsFormula, insertIntoM365Editor, messageToMarkdown } from '../messageActions';
import type { SnapshotMessage } from '../model';

const message: SnapshotMessage = {
  id: 'one',
  fingerprint: 'one',
  role: 'assistant',
  index: 0,
  plainText: 'Result: $x^2$',
  blocks: [
    { type: 'text', text: 'Result: $x^2$' },
    { type: 'code', language: 'ts', text: 'const x = 1;' },
  ],
  firstSeenAt: 1,
  updatedAt: 1,
};

describe('M365 message actions', () => {
  it('renders structured blocks as Markdown and detects formulas', () => {
    expect(messageToMarkdown(message)).toContain('```ts');
    expect(containsFormula(message)).toBe(true);
  });

  it('inserts text without submitting the editor', () => {
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    let submitted = false;
    textarea.closest('form')?.addEventListener('submit', () => {
      submitted = true;
    });

    expect(insertIntoM365Editor('Prompt')).toBe(true);
    expect(textarea.value).toBe('Prompt');
    expect(submitted).toBe(false);
  });
});
