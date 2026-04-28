/* eslint-disable no-console */
import { CanonicalConversationBuilder } from './m365CanonicalConversation';
import { M365ConversationExtractor } from './m365ConversationExtractor';
import type { CanonicalConversation, M365ContentItem } from './m365ConversationTypes';
import { M365ExportService } from './m365FeatureServices';

const TAG = '[M365 ChatExtractor]';
const DEFAULT_M365_EXPORT_TITLE = 'M365 Copilot';

interface ChatMessage {
  id: string;
  fingerprint: string;
  type: 'user' | 'assistant';
  text: string;
  content: M365ContentItem[];
  imageCount: number;
  index: number;
  visible: boolean;
  className: string;
  role: string;
}

interface ExtractResult {
  timestamp: string;
  url: string;
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  totalImages: number;
  messages: ChatMessage[];
}

interface M365JsonDebugExportResult {
  filename: string;
  json: string;
  payload: ReturnType<typeof M365ExportService.buildJsonExport>;
}

export function extractM365CanonicalConversation(): CanonicalConversation {
  const rawConversation = M365ConversationExtractor.extract();
  return CanonicalConversationBuilder.build(rawConversation);
}

function toLegacyExtractResult(conversation: CanonicalConversation): ExtractResult {
  return {
    timestamp: conversation.timestamp,
    url: conversation.url,
    totalMessages: conversation.totalMessages,
    userMessages: conversation.userMessages,
    assistantMessages: conversation.assistantMessages,
    totalImages: conversation.totalImages,
    messages: conversation.messages.map((message) => ({
      id: message.id,
      fingerprint: message.fingerprint,
      type: message.role,
      text: message.text,
      content: message.content,
      imageCount: message.imageCount,
      index: message.index,
      visible: message.visible,
      className: message.className,
      role: message.roleAttribute,
    })),
  };
}

function logExtractionResult(conversation: CanonicalConversation, result: ExtractResult): void {
  console.log(
    `${TAG} Found ${conversation.rawStats.rawUserNodeCount} raw user nodes, ${conversation.rawStats.rawAssistantNodeCount} raw copilot nodes, ${conversation.rawStats.logicalCandidateCount} logical candidates`,
  );
  console.log(`${TAG} Extraction complete:`);
  console.log(
    `${TAG}   Total: ${result.totalMessages} messages (${result.userMessages} user, ${result.assistantMessages} assistant, ${result.totalImages} images)`,
  );
  console.table(
    result.messages.map((message) => ({
      '#': message.index,
      id: message.id,
      type: message.type,
      imgs: message.imageCount,
      visible: message.visible,
      text: message.text.slice(0, 80) + (message.text.length > 80 ? '...' : ''),
    })),
  );
  console.log(`${TAG} Full result (also saved to window.__gvLastExtractResult):`, result);
}

export function extractM365Messages(): ExtractResult {
  const conversation = extractM365CanonicalConversation();
  const result = toLegacyExtractResult(conversation);

  logExtractionResult(conversation, result);
  return result;
}

function getM365ExportTitle(): string {
  return document.title.trim() || DEFAULT_M365_EXPORT_TITLE;
}

function buildM365JsonFilename(timestamp: string): string {
  const safeTimestamp = timestamp.replace(/[:.]/g, '-');
  return `m365-copilot-${safeTimestamp}.json`;
}

function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    try {
      document.body.removeChild(anchor);
    } catch {
      /* ignore */
    }
    URL.revokeObjectURL(url);
  }, 0);
}

function exportM365JsonForDebug(): M365JsonDebugExportResult {
  const conversation = extractM365CanonicalConversation();
  const title = getM365ExportTitle();
  const payload = M365ExportService.buildJsonExport(conversation, title);
  const json = M365ExportService.serializeJsonExport(conversation, title);
  const filename = buildM365JsonFilename(payload.exportedAt);
  downloadJson(json, filename);

  const result = { filename, json, payload };
  (window as unknown as Record<string, unknown>).__gvLastM365JsonExport = result;
  console.log(`${TAG} M365 JSON debug export downloaded as ${filename}.`, payload);
  return result;
}

export function startM365ChatExtractor(): void {
  console.log(
    `${TAG} Chat extractor loaded. Run window.__gvExtract() to extract current conversation. M365 JSON debug/dev only: window.__gvExportM365Json().`,
  );

  (window as unknown as Record<string, unknown>).__gvExtract = () => {
    const result = extractM365Messages();
    (window as unknown as Record<string, unknown>).__gvLastExtractResult = result;
    return result;
  };

  (window as unknown as Record<string, unknown>).__gvExtractCanonical = () => {
    const result = extractM365CanonicalConversation();
    (window as unknown as Record<string, unknown>).__gvLastCanonicalConversation = result;
    return result;
  };

  (window as unknown as Record<string, unknown>).__gvExportM365Json = () =>
    exportM365JsonForDebug();

  (window as unknown as Record<string, unknown>).__gvLastExtractResult = null;
  (window as unknown as Record<string, unknown>).__gvLastCanonicalConversation = null;
  (window as unknown as Record<string, unknown>).__gvLastM365JsonExport = null;
}
