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

interface M365ExportUiDeps {
  runExportAction?: typeof runM365ExportAction;
}

const DEFAULT_M365_EXPORT_TITLE = 'M365 Copilot';
const M365_EXPORT_UI_ROOT_ID = 'gv-m365-export-ui-root';
const M365_EXPORT_UI_STYLE_ID = 'gv-m365-export-ui-style';
const M365_EXPORT_DIALOG_ID = 'gv-m365-export-dialog';
const M365_EXPORT_TOAST_ID = 'gv-m365-export-toast';
const M365_EXPORT_STATUS_HIDE_MS = 2600;
const WINDOWS_RESERVED_FILENAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

let m365ExportToastTimer: number | null = null;
let m365ExportUiAction: typeof runM365ExportAction = runM365ExportAction;
let m365ExportDismissListenersAttached = false;

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
  return DEFAULT_M365_EXPORT_TITLE;
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
  const toast = ensureM365ExportToast();
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add('gv-m365-export-toast-visible');

  if (m365ExportToastTimer !== null) {
    window.clearTimeout(m365ExportToastTimer);
  }

  m365ExportToastTimer = window.setTimeout(() => {
    toast.classList.remove('gv-m365-export-toast-visible');
    m365ExportToastTimer = window.setTimeout(() => {
      if (!toast.classList.contains('gv-m365-export-toast-visible')) {
        toast.remove();
      }
      m365ExportToastTimer = null;
    }, 180);
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
  right: 56px;
  z-index: 2147483646;
  width: 112px;
  font-family: "Google Sans", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  color: #242424;
  pointer-events: auto;
}

.gv-m365-export-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid rgba(148, 163, 184, 0.42);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #0f172a;
  cursor: pointer;
  font: 600 13px/1 "Google Sans", "Segoe UI", system-ui, sans-serif;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14), 0 2px 8px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.gv-m365-export-trigger::after {
  content: "";
  width: 7px;
  height: 7px;
  border-right: 1.8px solid currentColor;
  border-bottom: 1.8px solid currentColor;
  transform: translateY(-2px) rotate(45deg);
}

.gv-m365-export-trigger:hover,
.gv-m365-export-trigger:focus-visible,
[data-gv-m365-export-ui][data-open='true'] .gv-m365-export-trigger {
  background: #ffffff;
  border-color: rgba(15, 108, 189, 0.52);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18), 0 0 0 3px rgba(15, 108, 189, 0.16);
  outline: none;
}

.gv-m365-export-trigger:active {
  transform: scale(0.98);
}

.gv-m365-export-dialog {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: 340px;
  padding: 18px;
  border: 1px solid rgba(226, 232, 240, 0.96);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.22), 0 4px 14px rgba(15, 23, 42, 0.1);
  color: #0f172a;
  opacity: 0;
  transform: translateY(-6px);
  transform-origin: top right;
  pointer-events: none;
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.gv-m365-export-dialog[hidden] {
  display: block;
  visibility: hidden;
}

[data-gv-m365-export-ui][data-open='true'] .gv-m365-export-dialog {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
  visibility: visible;
}

.gv-m365-export-dialog-title {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.25;
}

.gv-m365-export-dialog-subtitle {
  margin: 0 0 16px;
  color: #64748b;
  font-size: 13px;
  line-height: 1.4;
}

.gv-m365-export-format-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.gv-m365-export-format-option {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border: 2px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  cursor: pointer;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}

.gv-m365-export-format-option:hover,
.gv-m365-export-format-option:focus-within {
  border-color: #0f6cbd;
  background: #f8fafc;
}

.gv-m365-export-format-option[data-selected='true'] {
  border-color: #0f6cbd;
  background: #eff6ff;
  box-shadow: 0 0 0 3px rgba(15, 108, 189, 0.14);
}

.gv-m365-export-format-option input {
  width: 18px;
  height: 18px;
  margin: 1px 0 0;
  flex: 0 0 auto;
  accent-color: #0f6cbd;
}

.gv-m365-export-format-title {
  display: block;
  margin-bottom: 3px;
  color: #0f172a;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
}

.gv-m365-export-format-description {
  display: block;
  color: #64748b;
  font-size: 12px;
  line-height: 1.4;
}

.gv-m365-export-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.gv-m365-export-dialog-button {
  min-height: 34px;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid #d0d7de;
  background: transparent;
  color: #0f6cbd;
  cursor: pointer;
  font: 600 13px/1 "Google Sans", "Segoe UI", system-ui, sans-serif;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}

.gv-m365-export-dialog-button:hover,
.gv-m365-export-dialog-button:focus-visible {
  background: #f8fafc;
  border-color: #0f6cbd;
  outline: none;
}

.gv-m365-export-dialog-button-primary {
  border-color: #0f6cbd;
  background: #0f6cbd;
  color: #ffffff;
}

.gv-m365-export-dialog-button-primary:hover,
.gv-m365-export-dialog-button-primary:focus-visible {
  background: #115ea3;
  box-shadow: 0 2px 8px rgba(15, 108, 189, 0.32);
}

.gv-m365-export-toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 2147483647;
  max-width: 360px;
  padding: 12px 18px;
  border-radius: 8px;
  background: #1a73e8;
  color: #ffffff;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.22);
  font: 600 13px/1.35 "Google Sans", "Segoe UI", system-ui, sans-serif;
  opacity: 0;
  transform: translateY(18px);
  pointer-events: none;
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.gv-m365-export-toast-visible {
  opacity: 1;
  transform: translateY(0);
}

.gv-m365-export-toast[data-tone='success'] {
  background: #0f6c2f;
}

.gv-m365-export-toast[data-tone='error'] {
  background: #b42318;
}

@media (prefers-color-scheme: dark) {
  .gv-m365-export-trigger {
    border-color: rgba(148, 163, 184, 0.28);
    background: rgba(15, 23, 42, 0.82);
    color: #e2e8f0;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.32);
  }

  .gv-m365-export-trigger:hover,
  .gv-m365-export-trigger:focus-visible,
  [data-gv-m365-export-ui][data-open='true'] .gv-m365-export-trigger {
    background: #111827;
    border-color: rgba(96, 205, 255, 0.58);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.42), 0 0 0 3px rgba(96, 205, 255, 0.16);
  }

  .gv-m365-export-dialog {
    border-color: #1f2937;
    background: rgba(11, 18, 32, 0.98);
    color: #e2e8f0;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.48);
  }

  .gv-m365-export-dialog-subtitle,
  .gv-m365-export-format-description {
    color: #94a3b8;
  }

  .gv-m365-export-format-option {
    border-color: #334155;
    background: #0f172a;
  }

  .gv-m365-export-format-option:hover,
  .gv-m365-export-format-option:focus-within {
    border-color: #60cdff;
    background: #111827;
  }

  .gv-m365-export-format-option[data-selected='true'] {
    border-color: #60cdff;
    background: #102a43;
    box-shadow: 0 0 0 3px rgba(96, 205, 255, 0.15);
  }

  .gv-m365-export-format-title {
    color: #e2e8f0;
  }

  .gv-m365-export-dialog-button {
    border-color: #334155;
    color: #93c5fd;
  }

  .gv-m365-export-dialog-button:hover,
  .gv-m365-export-dialog-button:focus-visible {
    border-color: #60cdff;
    background: #111827;
  }

  .gv-m365-export-dialog-button-primary {
    border-color: #60cdff;
    background: #2563eb;
    color: #ffffff;
  }

  .gv-m365-export-dialog-button-primary:hover,
  .gv-m365-export-dialog-button-primary:focus-visible {
    background: #1d4ed8;
  }

  .gv-m365-export-toast {
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.42);
  }
}
`;
  document.head.appendChild(style);
}

function ensureM365ExportToast(): HTMLElement {
  const existing = document.getElementById(M365_EXPORT_TOAST_ID);
  if (existing) return existing;

  const toast = document.createElement('div');
  toast.id = M365_EXPORT_TOAST_ID;
  toast.className = 'gv-m365-export-toast';
  toast.dataset.gvM365ExportToast = 'true';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  document.body.appendChild(toast);
  return toast;
}

function getSelectedM365ExportFormat(root: HTMLElement): M365MinimalExportFormat {
  const checked = root.querySelector<HTMLInputElement>(
    'input[name="gv-m365-export-format"]:checked',
  );
  return checked?.value === 'json' ? 'json' : 'markdown';
}

function updateM365FormatSelection(root: HTMLElement, format: M365MinimalExportFormat): void {
  root.querySelectorAll<HTMLElement>('[data-gv-m365-export-option]').forEach((option) => {
    option.dataset.selected = option.dataset.gvM365ExportOption === format ? 'true' : 'false';
  });
}

function setM365ExportDialogOpen(root: HTMLElement, open: boolean): void {
  const dialog = root.querySelector<HTMLElement>('[data-gv-m365-export-dialog]');
  root.dataset.open = open ? 'true' : 'false';
  if (dialog) dialog.hidden = !open;
}

function closeM365ExportDialog(root: HTMLElement): void {
  setM365ExportDialogOpen(root, false);
  root
    .querySelector<HTMLElement>('[data-gv-m365-export-trigger]')
    ?.setAttribute('aria-expanded', 'false');
}

function createM365ExportTrigger(root: HTMLElement): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gv-m365-export-trigger';
  button.dataset.gvM365ExportTrigger = 'true';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', M365_EXPORT_DIALOG_ID);
  button.textContent = 'Export';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const nextOpen = root.dataset.open !== 'true';
    setM365ExportDialogOpen(root, nextOpen);
    button.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
  });
  return button;
}

function createM365FormatOption(
  format: M365MinimalExportFormat,
  title: string,
  description: string,
): HTMLLabelElement {
  const option = document.createElement('label');
  option.className = 'gv-m365-export-format-option';
  option.dataset.gvM365ExportOption = format;
  option.dataset.selected = format === 'markdown' ? 'true' : 'false';

  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = 'gv-m365-export-format';
  radio.value = format;
  radio.checked = format === 'markdown';

  const content = document.createElement('span');
  content.className = 'gv-m365-export-format-content';

  const titleElement = document.createElement('span');
  titleElement.className = 'gv-m365-export-format-title';
  titleElement.textContent = title;

  const descriptionElement = document.createElement('span');
  descriptionElement.className = 'gv-m365-export-format-description';
  descriptionElement.textContent = description;

  content.append(titleElement, descriptionElement);
  option.append(radio, content);

  return option;
}

function createM365ExportDialog(root: HTMLElement): HTMLElement {
  const dialog = document.createElement('div');
  dialog.id = M365_EXPORT_DIALOG_ID;
  dialog.className = 'gv-m365-export-dialog';
  dialog.dataset.gvM365ExportDialog = 'true';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'M365 export options');
  dialog.hidden = true;

  const title = document.createElement('h2');
  title.className = 'gv-m365-export-dialog-title';
  title.textContent = 'Export conversation';

  const subtitle = document.createElement('p');
  subtitle.className = 'gv-m365-export-dialog-subtitle';
  subtitle.textContent = 'Choose a lightweight M365 export format.';

  const list = document.createElement('div');
  list.className = 'gv-m365-export-format-list';
  list.append(
    createM365FormatOption('markdown', 'Markdown', 'Readable .md transcript for review.'),
    createM365FormatOption('json', 'JSON', 'Structured canonical conversation data.'),
  );
  list.addEventListener('change', () => {
    updateM365FormatSelection(root, getSelectedM365ExportFormat(root));
  });

  const actions = document.createElement('div');
  actions.className = 'gv-m365-export-dialog-actions';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'gv-m365-export-dialog-button';
  cancelButton.dataset.gvM365ExportCancel = 'true';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeM365ExportDialog(root);
  });

  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'gv-m365-export-dialog-button gv-m365-export-dialog-button-primary';
  exportButton.dataset.gvM365ExportConfirm = 'true';
  exportButton.textContent = 'Export';
  exportButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const format = getSelectedM365ExportFormat(root);
    closeM365ExportDialog(root);
    m365ExportUiAction(format);
  });

  actions.append(cancelButton, exportButton);
  dialog.append(title, subtitle, list, actions);
  return dialog;
}

function attachM365ExportDismissHandlers(): void {
  if (m365ExportDismissListenersAttached) return;

  const closeOnOutsideClick = (event: MouseEvent): void => {
    const root = document.getElementById(M365_EXPORT_UI_ROOT_ID);
    if (!root) return;
    if (root.dataset.open !== 'true') return;
    const target = event.target;
    if (target instanceof Node && root.contains(target)) return;
    closeM365ExportDialog(root);
  };

  const closeOnEscape = (event: KeyboardEvent): void => {
    const root = document.getElementById(M365_EXPORT_UI_ROOT_ID);
    if (!root) return;
    if (event.key === 'Escape') {
      closeM365ExportDialog(root);
    }
  };

  document.addEventListener('click', closeOnOutsideClick);
  document.addEventListener('keydown', closeOnEscape);
  m365ExportDismissListenersAttached = true;
}

export function startM365ExportUi(deps: M365ExportUiDeps = {}): void {
  if (document.getElementById(M365_EXPORT_UI_ROOT_ID)) return;

  m365ExportUiAction = deps.runExportAction ?? runM365ExportAction;
  ensureM365ExportUiStyle();

  const root = document.createElement('div');
  root.id = M365_EXPORT_UI_ROOT_ID;
  root.dataset.gvM365ExportUi = 'true';
  root.dataset.open = 'false';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'M365 export');
  root.appendChild(createM365ExportTrigger(root));
  root.appendChild(createM365ExportDialog(root));
  attachM365ExportDismissHandlers();

  document.body.appendChild(root);
}
