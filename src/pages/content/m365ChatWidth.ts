import { V2_STORAGE_KEYS } from '@/core/v2/repositories';
import { type SettingsV2, SettingsV2Schema } from '@/core/v2/schemas';

import { M365_CHAT_WIDTH_PERCENT, clampM365ChatWidthPercent } from './m365Settings';

const M365_CHAT_WIDTH_STYLE_ID = 'gv-m365-chat-width-style';
const M365_CHAT_WIDTH_ENABLED_CLASS = 'gv-m365-chat-width-enabled';

let storageListener:
  | ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void)
  | null = null;
let currentWidthPercent: number = M365_CHAT_WIDTH_PERCENT.defaultValue;
let currentEnabled = true;

function buildM365ChatWidthCss(widthPercent: number): string {
  const widthValue = `${clampM365ChatWidthPercent(widthPercent)}vw`;

  return `
html.${M365_CHAT_WIDTH_ENABLED_CLASS} [role="article"]:has([class*="fai-UserMessage"]),
html.${M365_CHAT_WIDTH_ENABLED_CLASS} [role="article"]:has([class*="fai-CopilotMessage"]) {
  width: min(100%, ${widthValue}) !important;
  max-width: min(100%, ${widthValue}) !important;
  margin-left: auto !important;
  margin-right: auto !important;
  box-sizing: border-box !important;
}

html.${M365_CHAT_WIDTH_ENABLED_CLASS} [id^="chatMessageContainer"]:has([class*="fai-UserMessage"]),
html.${M365_CHAT_WIDTH_ENABLED_CLASS} [id^="chatMessageContainer"]:has([class*="fai-CopilotMessage"]) {
  width: min(100%, ${widthValue}) !important;
  max-width: min(100%, ${widthValue}) !important;
  margin-left: auto !important;
  margin-right: auto !important;
  box-sizing: border-box !important;
}

html.${M365_CHAT_WIDTH_ENABLED_CLASS} [id^="chatMessageContainer"] div:has([role="article"][class*="fai-UserMessage"]),
html.${M365_CHAT_WIDTH_ENABLED_CLASS} [id^="chatMessageContainer"] div:has([role="article"][class*="fai-CopilotMessage"]) {
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
}

html.${M365_CHAT_WIDTH_ENABLED_CLASS} [class*="fai-UserMessage"],
html.${M365_CHAT_WIDTH_ENABLED_CLASS} [class*="fai-CopilotMessage"] {
  max-width: min(100%, ${widthValue}) !important;
  box-sizing: border-box !important;
}

html.${M365_CHAT_WIDTH_ENABLED_CLASS} [class*="fai-UserMessage__message"],
html.${M365_CHAT_WIDTH_ENABLED_CLASS} [class*="fai-CopilotMessage__content"] {
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
}
`;
}

function ensureM365ChatWidthStyle(): void {
  let style = document.getElementById(M365_CHAT_WIDTH_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = M365_CHAT_WIDTH_STYLE_ID;
    document.head.appendChild(style);
  }

  style.textContent = buildM365ChatWidthCss(currentWidthPercent);
}

function removeM365ChatWidthStyle(): void {
  document.getElementById(M365_CHAT_WIDTH_STYLE_ID)?.remove();
}

function applyM365ChatWidth(): void {
  if (!currentEnabled) {
    document.documentElement.classList.remove(M365_CHAT_WIDTH_ENABLED_CLASS);
    removeM365ChatWidthStyle();
    return;
  }

  document.documentElement.classList.add(M365_CHAT_WIDTH_ENABLED_CLASS);
  ensureM365ChatWidthStyle();
}

function applySettings(settings: SettingsV2): void {
  currentEnabled = settings.platforms.m365.enabled;
  currentWidthPercent = clampM365ChatWidthPercent(settings.platforms.m365.chatWidthPercent);
  applyM365ChatWidth();
}

function readStoredM365ChatWidthSettings(): void {
  try {
    chrome.storage?.sync?.get(V2_STORAGE_KEYS.SETTINGS, (result) => {
      const parsed = SettingsV2Schema.safeParse(result?.[V2_STORAGE_KEYS.SETTINGS]);
      if (parsed.success) applySettings(parsed.data);
    });
  } catch {}
}

function ensureStorageListener(): void {
  if (storageListener) return;

  storageListener = (changes, area) => {
    if (area !== 'sync') return;

    const changed = changes[V2_STORAGE_KEYS.SETTINGS];
    if (!changed) return;
    const parsed = SettingsV2Schema.safeParse(changed.newValue);
    if (parsed.success) applySettings(parsed.data);
  };

  chrome.storage?.onChanged?.addListener(storageListener);
}

export function stopM365ChatWidth(): void {
  document.documentElement.classList.remove(M365_CHAT_WIDTH_ENABLED_CLASS);
  removeM365ChatWidthStyle();
  if (storageListener) {
    chrome.storage?.onChanged?.removeListener(storageListener);
    storageListener = null;
  }
  currentEnabled = true;
  currentWidthPercent = M365_CHAT_WIDTH_PERCENT.defaultValue;
}

export function startM365ChatWidth(initialSettings?: SettingsV2): void {
  if (initialSettings) applySettings(initialSettings);
  applyM365ChatWidth();
  readStoredM365ChatWidthSettings();
  ensureStorageListener();
}
