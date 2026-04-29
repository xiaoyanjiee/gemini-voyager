const M365_CHAT_WIDTH_STYLE_ID = 'gv-m365-chat-width-style';
const M365_CHAT_WIDTH_ENABLED_CLASS = 'gv-m365-chat-width-enabled';
const M365_CHAT_WIDTH_MAX = '1440px';

function buildM365ChatWidthCss(): string {
  return `
html.${M365_CHAT_WIDTH_ENABLED_CLASS} [role="article"]:has([class*="fai-UserMessage"]),
html.${M365_CHAT_WIDTH_ENABLED_CLASS} [role="article"]:has([class*="fai-CopilotMessage"]) {
  width: min(100%, ${M365_CHAT_WIDTH_MAX}) !important;
  max-width: min(100%, ${M365_CHAT_WIDTH_MAX}) !important;
  margin-left: auto !important;
  margin-right: auto !important;
  box-sizing: border-box !important;
}

html.${M365_CHAT_WIDTH_ENABLED_CLASS} [class*="fai-UserMessage"],
html.${M365_CHAT_WIDTH_ENABLED_CLASS} [class*="fai-CopilotMessage"] {
  max-width: min(100%, ${M365_CHAT_WIDTH_MAX}) !important;
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
  if (document.getElementById(M365_CHAT_WIDTH_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = M365_CHAT_WIDTH_STYLE_ID;
  style.textContent = buildM365ChatWidthCss();
  document.head.appendChild(style);
}

function enableM365ChatWidthMarker(): void {
  document.documentElement.classList.add(M365_CHAT_WIDTH_ENABLED_CLASS);
}

export function stopM365ChatWidth(): void {
  document.documentElement.classList.remove(M365_CHAT_WIDTH_ENABLED_CLASS);
  document.getElementById(M365_CHAT_WIDTH_STYLE_ID)?.remove();
}

export function startM365ChatWidth(): void {
  enableM365ChatWidthMarker();
  ensureM365ChatWidthStyle();
}
