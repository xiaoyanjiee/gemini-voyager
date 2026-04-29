import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { startM365ChatWidth, stopM365ChatWidth } from './m365ChatWidth';

const STYLE_ID = 'gv-m365-chat-width-style';
const ENABLED_CLASS = 'gv-m365-chat-width-enabled';

function getStyleText(): string {
  const style = document.getElementById(STYLE_ID);
  expect(style).not.toBeNull();
  return style?.textContent ?? '';
}

function getSourceText(): string {
  return readFileSync('src/pages/content/m365ChatWidth.ts', 'utf8');
}

describe('M365 chat width', () => {
  afterEach(() => {
    stopM365ChatWidth();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('injects one M365-only style and marker', () => {
    startM365ChatWidth();

    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);
    expect(document.documentElement.classList.contains(ENABLED_CLASS)).toBe(true);
    expect(getStyleText()).toContain(`html.${ENABLED_CLASS}`);
  });

  it('keeps repeated startup idempotent', () => {
    startM365ChatWidth();
    startM365ChatWidth();
    startM365ChatWidth();

    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);
    expect(document.documentElement.classList.contains(ENABLED_CLASS)).toBe(true);
  });

  it('uses M365-only selectors and avoids Gemini chat width selectors', () => {
    startM365ChatWidth();

    const styleText = getStyleText();
    expect(styleText).toContain('fai-UserMessage');
    expect(styleText).toContain('fai-CopilotMessage');
    expect(styleText).toContain('[role="article"]');
    expect(styleText).not.toContain('chat-window');
    expect(styleText).not.toContain('user-query');
    expect(styleText).not.toContain('model-response');
    expect(styleText).not.toContain('response-container');
    expect(styleText).not.toContain('.conversation-container');
    expect(styleText).not.toContain('geminiChatWidth');
  });

  it('does not modify the M365 export UI root', () => {
    const exportRoot = document.createElement('div');
    exportRoot.id = 'gv-m365-export-ui-root';
    exportRoot.dataset.gvM365ExportUi = 'true';
    exportRoot.textContent = 'Export JSON';
    document.body.appendChild(exportRoot);

    startM365ChatWidth();

    expect(document.getElementById('gv-m365-export-ui-root')).toBe(exportRoot);
    expect(document.querySelectorAll('[data-gv-m365-export-ui]')).toHaveLength(1);
    expect(exportRoot.textContent).toBe('Export JSON');
  });

  it('does not depend on canonical conversation, export services, or message body reads', () => {
    const sourceText = getSourceText();

    expect(sourceText).not.toContain('CanonicalConversation');
    expect(sourceText).not.toContain('M365ExportService');
    expect(sourceText).not.toContain('sourceElement');
    expect(sourceText).not.toContain('contentElement');
    expect(sourceText).not.toContain('innerText');
  });

  it('cleans up style and marker', () => {
    startM365ChatWidth();

    stopM365ChatWidth();

    expect(document.querySelector(`#${STYLE_ID}`)).toBeNull();
    expect(document.documentElement.classList.contains(ENABLED_CLASS)).toBe(false);
  });
});
