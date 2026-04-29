import { extractM365CanonicalConversation } from './m365ChatExtractor';
import type { CanonicalConversation } from './m365ConversationTypes';
import { M365ExportService } from './m365FeatureServices';

export type M365MinimalExportFormat = 'json' | 'markdown';

export type M365ExportActionStatus = 'downloaded' | 'empty' | 'error';

export interface M365ExportActionResult {
  status: M365ExportActionStatus;
  format: M365MinimalExportFormat;
  filename?: string;
  content?: string;
  error?: unknown;
}

interface M365ExportActionDeps {
  extractConversation?: () => CanonicalConversation;
  buildTurns?: typeof M365ExportService.buildTurns;
  serializeJsonExport?: typeof M365ExportService.serializeJsonExport;
  serializeMarkdownExport?: typeof M365ExportService.serializeMarkdownExport;
  downloadText?: (content: string, filename: string, type: string) => void;
  showStatus?: (message: string, tone?: M365StatusTone) => void;
  getTitle?: () => string;
  now?: () => Date;
}

type M365StatusTone = 'info' | 'success' | 'error';

const DEFAULT_M365_EXPORT_TITLE = 'M365 Copilot';
const M365_EXPORT_UI_ROOT_ID = 'gv-m365-export-ui-root';
const M365_EXPORT_UI_STYLE_ID = 'gv-m365-export-ui-style';
const M365_EXPORT_STATUS_HIDE_MS = 2600;
const WINDOWS_RESERVED_FILENAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function sanitizeM365ExportFilenameBase(value: string | null | undefined): string {
  const sanitized = (value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  if (!sanitized || WINDOWS_RESERVED_FILENAME_PATTERN.test(sanitized)) {
    return DEFAULT_M365_EXPORT_TITLE;
  }

  return sanitized;
}

export function buildM365ExportFilename(
  title: string | null | undefined,
  extension: 'json' | 'md',
  exportedAt: Date = new Date(),
): string {
  const base = sanitizeM365ExportFilenameBase(title);
  const safeTimestamp = exportedAt.toISOString().replace(/[:.]/g, '-');
  return `${base}-${safeTimestamp}.${extension}`;
}

function getM365ExportTitle(): string {
  return sanitizeM365ExportFilenameBase(document.title || DEFAULT_M365_EXPORT_TITLE);
}

function downloadText(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

function getFormatMetadata(format: M365MinimalExportFormat): {
  extension: 'json' | 'md';
  contentType: string;
  successLabel: string;
} {
  if (format === 'json') {
    return {
      extension: 'json',
      contentType: 'application/json;charset=utf-8',
      successLabel: 'JSON',
    };
  }

  return {
    extension: 'md',
    contentType: 'text/markdown;charset=utf-8',
    successLabel: 'Markdown',
  };
}

function showM365ExportStatus(message: string, tone: M365StatusTone = 'info'): void {
  const root = document.getElementById(M365_EXPORT_UI_ROOT_ID);
  const status = root?.querySelector<HTMLElement>('[data-gv-m365-export-status]');
  if (!status) return;

  status.textContent = message;
  status.dataset.tone = tone;
  status.hidden = false;

  window.setTimeout(() => {
    status.hidden = true;
  }, M365_EXPORT_STATUS_HIDE_MS);
}

export function runM365ExportAction(
  format: M365MinimalExportFormat,
  deps: M365ExportActionDeps = {},
): M365ExportActionResult {
  const showStatus = deps.showStatus ?? showM365ExportStatus;

  try {
    const extractConversation = deps.extractConversation ?? extractM365CanonicalConversation;
    const buildTurns = deps.buildTurns ?? M365ExportService.buildTurns.bind(M365ExportService);
    const conversation = extractConversation();
    const turns = buildTurns(conversation);

    if (turns.length === 0) {
      showStatus('No exportable M365 messages found.', 'info');
      return { status: 'empty', format };
    }

    const title = sanitizeM365ExportFilenameBase(
      deps.getTitle ? deps.getTitle() : getM365ExportTitle(),
    );
    const metadata = getFormatMetadata(format);
    const content =
      format === 'json'
        ? (
            deps.serializeJsonExport ??
            M365ExportService.serializeJsonExport.bind(M365ExportService)
          )(conversation, title)
        : (
            deps.serializeMarkdownExport ??
            M365ExportService.serializeMarkdownExport.bind(M365ExportService)
          )(conversation, title);
    const filename = buildM365ExportFilename(title, metadata.extension, deps.now?.() ?? new Date());
    const runDownload = deps.downloadText ?? downloadText;

    runDownload(content, filename, metadata.contentType);
    showStatus(`Exported ${metadata.successLabel}.`, 'success');
    return { status: 'downloaded', format, filename, content };
  } catch (error) {
    showStatus('M365 export failed.', 'error');
    return { status: 'error', format, error };
  }
}

function ensureM365ExportUiStyle(): void {
  if (document.getElementById(M365_EXPORT_UI_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = M365_EXPORT_UI_STYLE_ID;
  style.textContent = `
[data-gv-m365-export-ui] {
  position: fixed;
  top: 72px;
  right: 16px;
  z-index: 2147483646;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  width: 132px;
  padding: 8px;
  border: 1px solid rgba(60, 64, 67, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 2px 10px rgba(60, 64, 67, 0.16);
  font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  color: #242424;
  pointer-events: auto;
}

.gv-m365-export-button {
  display: block;
  width: 100%;
  min-height: 30px;
  padding: 5px 8px;
  border: 1px solid rgba(60, 64, 67, 0.18);
  border-radius: 6px;
  background: #ffffff;
  color: #242424;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  line-height: 1.2;
  text-align: center;
}

.gv-m365-export-button:hover {
  background: #f5f5f5;
}

.gv-m365-export-button:active {
  background: #eeeeee;
}

.gv-m365-export-status {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.35;
  color: #616161;
  overflow-wrap: anywhere;
}

.gv-m365-export-status[data-tone='success'] {
  color: #0f6c2f;
}

.gv-m365-export-status[data-tone='error'] {
  color: #b42318;
}

@media (prefers-color-scheme: dark) {
  [data-gv-m365-export-ui] {
    border-color: rgba(255, 255, 255, 0.14);
    background: rgba(32, 32, 32, 0.94);
    color: #f5f5f5;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.28);
  }

  .gv-m365-export-button {
    border-color: rgba(255, 255, 255, 0.16);
    background: #2b2b2b;
    color: #f5f5f5;
  }

  .gv-m365-export-button:hover {
    background: #333333;
  }

  .gv-m365-export-button:active {
    background: #3a3a3a;
  }

  .gv-m365-export-status {
    color: #d1d1d1;
  }

  .gv-m365-export-status[data-tone='success'] {
    color: #6ccb8e;
  }

  .gv-m365-export-status[data-tone='error'] {
    color: #ffb4ab;
  }
}
`;
  document.head.appendChild(style);
}

function createM365ExportButton(format: M365MinimalExportFormat, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gv-m365-export-button';
  button.dataset.gvM365ExportFormat = format;
  button.textContent = label;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    runM365ExportAction(format);
  });
  return button;
}

export function startM365ExportUi(): void {
  if (document.getElementById(M365_EXPORT_UI_ROOT_ID)) return;

  ensureM365ExportUiStyle();

  const root = document.createElement('div');
  root.id = M365_EXPORT_UI_ROOT_ID;
  root.dataset.gvM365ExportUi = 'true';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'M365 export');
  root.appendChild(createM365ExportButton('json', 'Export JSON'));
  root.appendChild(createM365ExportButton('markdown', 'Export Markdown'));

  const status = document.createElement('div');
  status.className = 'gv-m365-export-status';
  status.dataset.gvM365ExportStatus = 'true';
  status.hidden = true;
  root.appendChild(status);

  document.body.appendChild(root);
}
