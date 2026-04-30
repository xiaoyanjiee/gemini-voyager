import { extractM365CanonicalConversation } from './m365ChatExtractor';
import type { CanonicalConversation, CanonicalMessage } from './m365ConversationTypes';
import { type M365TimelineIndexItem, M365TimelineService } from './m365FeatureServices';
import {
  type M365TimelineScrollMode,
  M365_TIMELINE_DEFAULT_SCROLL_MODE,
  M365_TIMELINE_ENABLED_KEY,
  M365_TIMELINE_SCROLL_MODE_KEY,
  normalizeM365TimelineScrollMode,
} from './m365Settings';

const M365_TIMELINE_ROOT_ID = 'gv-m365-timeline-root';
const M365_TIMELINE_STYLE_ID = 'gv-m365-timeline-style';
const M365_TIMELINE_TOOLTIP_ID = 'gv-m365-timeline-tooltip';
const M365_TIMELINE_ACTIVE_CLASS = 'gv-m365-timeline-marker-active';
const M365_TIMELINE_REFRESH_DELAY_MS = 150;
const M365_TIMELINE_MAX_SUMMARY_LENGTH = 80;

interface M365TimelineDeps {
  extractConversation?: () => CanonicalConversation;
  buildIndex?: typeof M365TimelineService.buildIndex;
  scrollToElement?: (element: Element) => void;
}

interface M365TimelineCurrentItem {
  key: string;
  item: M365TimelineIndexItem;
}

interface M365TimelineEntry {
  key: string;
  currentId: string;
  index: number;
  summary: string;
  sourceElement: Element | null;
  visible: boolean;
}

let observer: MutationObserver | null = null;
let refreshTimer: number | null = null;
let activeMarkerKey: string | null = null;
let timelineConversationKey: string | null = null;
let timelineEntries: M365TimelineEntry[] = [];
let timelineDeps: Required<M365TimelineDeps> = getDefaultDeps();
let timelineEnabled = true;
let timelineScrollMode: M365TimelineScrollMode = M365_TIMELINE_DEFAULT_SCROLL_MODE;
let storageListener:
  | ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void)
  | null = null;

function getDefaultDeps(): Required<M365TimelineDeps> {
  return {
    extractConversation: extractM365CanonicalConversation,
    buildIndex: M365TimelineService.buildIndex.bind(M365TimelineService),
    scrollToElement: (element: Element) => {
      element.scrollIntoView({
        block: 'start',
        behavior: timelineScrollMode === 'jump' ? 'auto' : 'smooth',
      });
    },
  };
}

function ensureM365TimelineStyle(): void {
  if (document.getElementById(M365_TIMELINE_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = M365_TIMELINE_STYLE_ID;
  style.textContent = `
#${M365_TIMELINE_ROOT_ID} {
  position: fixed;
  top: 60px;
  right: 18px;
  bottom: 154px;
  z-index: 2147483645;
  width: 24px;
  pointer-events: none;
  font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  --gv-m365-timeline-marker-color: #94a3b8;
  --gv-m365-timeline-marker-active-color: #0f6cbd;
  --gv-m365-timeline-bar-bg: rgba(248, 250, 252, 0.88);
  --gv-m365-timeline-tooltip-bg: #ffffff;
  --gv-m365-timeline-tooltip-text: #0f172a;
  --gv-m365-timeline-tooltip-border: #e2e8f0;
  --gv-m365-timeline-tooltip-shadow: 0 12px 36px rgba(2, 8, 23, 0.18), 0 3px 8px rgba(2, 8, 23, 0.08);
}

.gv-m365-timeline-rail {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 12px;
  overflow: visible;
  pointer-events: auto;
}

.gv-m365-timeline-rail::before {
  content: "";
  position: absolute;
  inset: 0;
  left: 50%;
  width: 24px;
  border-radius: 12px;
  background: var(--gv-m365-timeline-bar-bg);
  box-shadow: 0 2px 12px rgba(15, 23, 42, 0.08);
  transform: translateX(-50%);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.gv-m365-timeline-marker {
  position: absolute;
  left: 50%;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  transform: translate(-50%, -50%);
  pointer-events: auto;
}

.gv-m365-timeline-marker::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--gv-m365-timeline-marker-color);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.92), 0 2px 8px rgba(15, 23, 42, 0.22);
  transform: translate(-50%, -50%);
  transition:
    background 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.15s ease;
}

.gv-m365-timeline-marker:hover,
.gv-m365-timeline-marker:focus-visible,
.${M365_TIMELINE_ACTIVE_CLASS} {
  outline: none;
}

.gv-m365-timeline-marker:hover::after,
.gv-m365-timeline-marker:focus-visible::after {
  background: var(--gv-m365-timeline-marker-active-color);
  transform: translate(-50%, -50%) scale(1.15);
}

.${M365_TIMELINE_ACTIVE_CLASS}::after {
  background: var(--gv-m365-timeline-marker-active-color);
  box-shadow:
    0 0 0 3px var(--gv-m365-timeline-marker-active-color),
    0 0 14px rgba(15, 108, 189, 0.5);
}

.gv-m365-timeline-marker-stale {
  opacity: 0.54;
}

.gv-m365-timeline-marker-stale::after {
  background: transparent;
  border: 2px solid var(--gv-m365-timeline-marker-color);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.88);
}

#${M365_TIMELINE_TOOLTIP_ID} {
  position: fixed;
  z-index: 2147483646;
  max-width: 288px;
  padding: 10px 12px;
  border: 1px solid var(--gv-m365-timeline-tooltip-border);
  border-radius: 14px;
  background: var(--gv-m365-timeline-tooltip-bg);
  box-shadow: var(--gv-m365-timeline-tooltip-shadow);
  color: var(--gv-m365-timeline-tooltip-text);
  font-family: "Google Sans", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  pointer-events: none;
}

#${M365_TIMELINE_TOOLTIP_ID}[hidden] {
  display: none;
}

@media (prefers-color-scheme: dark) {
  #${M365_TIMELINE_ROOT_ID} {
    --gv-m365-timeline-marker-color: #475569;
    --gv-m365-timeline-marker-active-color: #60cdff;
    --gv-m365-timeline-bar-bg: rgba(2, 6, 23, 0.75);
    --gv-m365-timeline-tooltip-bg: #0b1220;
    --gv-m365-timeline-tooltip-text: #e2e8f0;
    --gv-m365-timeline-tooltip-border: #1f2937;
    --gv-m365-timeline-tooltip-shadow: 0 12px 36px rgba(0, 0, 0, 0.42), 0 3px 8px rgba(0, 0, 0, 0.24);
  }

  .gv-m365-timeline-marker::after {
    box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.92), 0 2px 8px rgba(0, 0, 0, 0.34);
  }

  .gv-m365-timeline-marker-stale::after {
    box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.88);
  }

  .${M365_TIMELINE_ACTIVE_CLASS}::after {
    box-shadow:
      0 0 0 3px var(--gv-m365-timeline-marker-active-color),
      0 0 14px rgba(96, 205, 255, 0.46);
  }
}
`;
  document.head.appendChild(style);
}

function ensureM365TimelineRoot(): HTMLElement {
  const existing = document.getElementById(M365_TIMELINE_ROOT_ID);
  if (existing) return existing;

  const root = document.createElement('nav');
  root.id = M365_TIMELINE_ROOT_ID;
  root.dataset.gvM365Timeline = 'true';
  root.setAttribute('aria-label', 'M365 conversation timeline');

  const rail = document.createElement('div');
  rail.className = 'gv-m365-timeline-rail';
  rail.dataset.gvM365TimelineRail = 'true';
  root.appendChild(rail);
  document.body.appendChild(root);
  return root;
}

function ensureM365TimelineTooltip(): HTMLElement {
  const existing = document.getElementById(M365_TIMELINE_TOOLTIP_ID);
  if (existing) return existing;

  const tooltip = document.createElement('div');
  tooltip.id = M365_TIMELINE_TOOLTIP_ID;
  tooltip.dataset.gvM365TimelineTooltip = 'true';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  return tooltip;
}

function getRail(root: HTMLElement): HTMLElement {
  const existing = root.querySelector<HTMLElement>('[data-gv-m365-timeline-rail]');
  if (existing) return existing;

  const rail = document.createElement('div');
  rail.className = 'gv-m365-timeline-rail';
  rail.dataset.gvM365TimelineRail = 'true';
  root.appendChild(rail);
  return rail;
}

function getCurrentUserTimelineItems(): {
  conversationKey: string;
  items: M365TimelineCurrentItem[];
} {
  const conversation = timelineDeps.extractConversation();
  const userMessages = conversation.messages.filter((message) => message.role === 'user');
  const userItems = timelineDeps.buildIndex(conversation).filter((item) => item.role === 'user');

  return {
    conversationKey: getTimelineConversationKey(conversation),
    items: userItems.map((item, index) => ({
      key: getStableTimelineKey(userMessages[index], item),
      item,
    })),
  };
}

function getTimelineConversationKey(conversation: CanonicalConversation): string {
  try {
    const url = new URL(conversation.url);
    return `${url.origin}${url.pathname}`;
  } catch {
    return conversation.url.split('?')[0] || 'm365:unknown-conversation';
  }
}

function getStableTimelineKey(
  message: CanonicalMessage | undefined,
  item: M365TimelineIndexItem,
): string {
  const stableText = message?.fingerprint || item.summary || item.id;
  return `${item.role}:${normalizeTimelineKey(stableText)}`;
}

function normalizeTimelineKey(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function renderM365TimelineMarkers(): void {
  if (!timelineEnabled) {
    removeM365TimelineUi();
    return;
  }

  const root = ensureM365TimelineRoot();
  const rail = getRail(root);
  const { conversationKey, items } = getCurrentUserTimelineItems();
  const entries = mergeTimelineEntries(conversationKey, items);
  const nextSignature = entries
    .map((entry) => `${entry.key}:${entry.summary}:${entry.visible ? 'visible' : 'stale'}`)
    .join('|');

  if (rail.dataset.gvM365TimelineSignature === nextSignature) return;

  rail.dataset.gvM365TimelineSignature = nextSignature;
  rail.replaceChildren(
    ...entries.map((entry, index) => createTimelineMarker(entry, index, entries.length)),
  );
  if (activeMarkerKey && !entries.some((entry) => entry.key === activeMarkerKey)) {
    activeMarkerKey = null;
  }
  updateActiveMarker();
}

function mergeTimelineEntries(
  conversationKey: string,
  currentItems: M365TimelineCurrentItem[],
): M365TimelineEntry[] {
  if (timelineConversationKey !== conversationKey) {
    timelineConversationKey = conversationKey;
    timelineEntries = [];
    activeMarkerKey = null;
  }

  const currentKeys = new Set(currentItems.map((current) => current.key));
  const existingKeys = new Set(timelineEntries.map((entry) => entry.key));
  const currentEntries = currentItems.map(({ key, item }) => ({
    key,
    currentId: item.id,
    index: item.index,
    summary: normalizeTimelineSummary(item.summary),
    sourceElement: item.sourceElement,
    visible: true,
  }));

  const existingByKey = new Map(timelineEntries.map((entry) => [entry.key, entry]));
  const updatedCurrentEntries = currentEntries.map((entry) => ({
    ...(existingByKey.get(entry.key) ?? entry),
    ...entry,
  }));

  const firstOverlap = currentItems.find((current) => existingKeys.has(current.key));
  const firstOverlapExistingIndex = firstOverlap
    ? timelineEntries.findIndex((entry) => entry.key === firstOverlap.key)
    : -1;
  const insertIndex =
    firstOverlapExistingIndex < 0
      ? -1
      : timelineEntries
          .slice(0, firstOverlapExistingIndex)
          .filter((entry) => !currentKeys.has(entry.key)).length;

  let nextEntries = timelineEntries
    .filter((entry) => !currentKeys.has(entry.key))
    .map((entry) => ({
      ...entry,
      sourceElement: entry.sourceElement?.isConnected ? entry.sourceElement : null,
      visible: false,
    }));

  if (!firstOverlap) {
    nextEntries = [...nextEntries, ...updatedCurrentEntries];
  } else {
    nextEntries.splice(insertIndex, 0, ...updatedCurrentEntries);
  }

  timelineEntries = nextEntries;
  return timelineEntries;
}

function createTimelineMarker(
  entry: M365TimelineEntry,
  markerIndex: number,
  markerCount: number,
): HTMLButtonElement {
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.className = 'gv-m365-timeline-marker';
  marker.classList.toggle('gv-m365-timeline-marker-stale', !entry.visible);
  marker.dataset.gvM365TimelineMarker = 'true';
  marker.dataset.gvM365TimelineKey = entry.key;
  marker.dataset.gvM365TimelineId = entry.currentId;
  marker.dataset.gvM365TimelineIndex = String(entry.index);
  marker.dataset.gvM365TimelineSummary = entry.summary;
  marker.dataset.gvM365TimelineVisible = entry.visible ? 'true' : 'false';
  marker.setAttribute('aria-label', marker.dataset.gvM365TimelineSummary);
  marker.setAttribute('aria-describedby', M365_TIMELINE_TOOLTIP_ID);
  marker.style.top = getMarkerTopPercent(markerIndex, markerCount);
  return marker;
}

function normalizeTimelineSummary(summary: string): string {
  const compact = summary.replace(/\s+/g, ' ').trim();
  if (!compact) return 'User message';
  return compact.length > M365_TIMELINE_MAX_SUMMARY_LENGTH
    ? `${compact.slice(0, M365_TIMELINE_MAX_SUMMARY_LENGTH - 3)}...`
    : compact;
}

function getMarkerTopPercent(index: number, count: number): string {
  if (count <= 1) return '50%';
  const paddedStart = 4;
  const paddedEnd = 96;
  return `${paddedStart + (index / (count - 1)) * (paddedEnd - paddedStart)}%`;
}

function findTimelineItem(marker: HTMLElement): M365TimelineIndexItem | null {
  const key = marker.dataset.gvM365TimelineKey;
  if (!key) return null;

  const cachedEntry = timelineEntries.find((entry) => entry.key === key);
  if (cachedEntry?.sourceElement?.isConnected) {
    return {
      id: cachedEntry.currentId,
      index: cachedEntry.index,
      role: 'user',
      summary: cachedEntry.summary,
      sourceElement: cachedEntry.sourceElement,
    };
  }

  const currentItems = getCurrentUserTimelineItems();
  const refreshedItems = mergeTimelineEntries(currentItems.conversationKey, currentItems.items);
  const refreshedEntry = refreshedItems.find((entry) => entry.key === key);
  if (!refreshedEntry?.sourceElement?.isConnected) return null;

  return {
    id: refreshedEntry.currentId,
    index: refreshedEntry.index,
    role: 'user',
    summary: refreshedEntry.summary,
    sourceElement: refreshedEntry.sourceElement,
  };
}

function handleTimelineClick(event: Event): void {
  const marker = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    '[data-gv-m365-timeline-marker]',
  );
  if (!marker) return;

  const item = findTimelineItem(marker);
  if (!item) return;

  activeMarkerKey = marker.dataset.gvM365TimelineKey || null;
  updateActiveMarker();
  timelineDeps.scrollToElement(item.sourceElement);
}

function handleTimelineOver(event: MouseEvent): void {
  const marker = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    '[data-gv-m365-timeline-marker]',
  );
  if (marker) showTimelineTooltip(marker);
}

function handleTimelineOut(event: MouseEvent): void {
  const fromMarker = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    '[data-gv-m365-timeline-marker]',
  );
  const toMarker = (event.relatedTarget as HTMLElement | null)?.closest?.(
    '[data-gv-m365-timeline-marker]',
  );
  if (fromMarker && !toMarker) hideTimelineTooltip();
}

function handleTimelineFocus(event: FocusEvent): void {
  const marker = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    '[data-gv-m365-timeline-marker]',
  );
  if (marker) showTimelineTooltip(marker);
}

function handleTimelineBlur(event: FocusEvent): void {
  const marker = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    '[data-gv-m365-timeline-marker]',
  );
  if (marker) hideTimelineTooltip();
}

function showTimelineTooltip(marker: HTMLElement): void {
  const tooltip = ensureM365TimelineTooltip();
  const summary = marker.dataset.gvM365TimelineSummary || marker.getAttribute('aria-label') || '';
  const markerRect = marker.getBoundingClientRect();
  const viewportPadding = 8;

  tooltip.textContent = summary;
  tooltip.hidden = false;

  const tooltipRect = tooltip.getBoundingClientRect();
  const tooltipWidth = tooltipRect.width || 312;
  const tooltipHeight = tooltipRect.height || 56;
  const exportRootRect = document.getElementById('gv-m365-export-ui-root')?.getBoundingClientRect();
  let left = Math.max(viewportPadding, markerRect.left - tooltipWidth - 12);
  const top = Math.max(
    viewportPadding,
    Math.min(window.innerHeight - tooltipHeight - viewportPadding, markerRect.top - 10),
  );

  if (
    exportRootRect &&
    top < exportRootRect.bottom + 8 &&
    top + tooltipHeight > exportRootRect.top - 8 &&
    left < exportRootRect.right + 8 &&
    left + tooltipWidth > exportRootRect.left - 8
  ) {
    left = Math.max(viewportPadding, exportRootRect.left - tooltipWidth - 12);
  }

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTimelineTooltip(): void {
  const tooltip = document.getElementById(M365_TIMELINE_TOOLTIP_ID);
  if (tooltip) tooltip.hidden = true;
}

function updateActiveMarker(): void {
  document.querySelectorAll<HTMLElement>('[data-gv-m365-timeline-marker]').forEach((marker) => {
    marker.classList.toggle(
      M365_TIMELINE_ACTIVE_CLASS,
      Boolean(activeMarkerKey && marker.dataset.gvM365TimelineKey === activeMarkerKey),
    );
  });
}

function attachTimelineListeners(root: HTMLElement): void {
  if (root.dataset.gvM365TimelineListeners === 'true') return;

  root.addEventListener('click', handleTimelineClick);
  root.addEventListener('mouseover', handleTimelineOver);
  root.addEventListener('mouseout', handleTimelineOut);
  root.addEventListener('focusin', handleTimelineFocus);
  root.addEventListener('focusout', handleTimelineBlur);
  root.dataset.gvM365TimelineListeners = 'true';
}

function detachTimelineListeners(root: HTMLElement): void {
  root.removeEventListener('click', handleTimelineClick);
  root.removeEventListener('mouseover', handleTimelineOver);
  root.removeEventListener('mouseout', handleTimelineOut);
  root.removeEventListener('focusin', handleTimelineFocus);
  root.removeEventListener('focusout', handleTimelineBlur);
  delete root.dataset.gvM365TimelineListeners;
}

function scheduleTimelineRefresh(): void {
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
  }

  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    try {
      renderM365TimelineMarkers();
    } catch (error) {
      console.warn('[Gemini Voyager] M365 timeline refresh failed:', error);
    }
  }, M365_TIMELINE_REFRESH_DELAY_MS);
}

function ensureTimelineObserver(): void {
  if (!timelineEnabled) return;
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    if (
      mutations.every((mutation) => {
        const target = mutation.target;
        return (
          target instanceof Element &&
          (target.closest(`#${M365_TIMELINE_ROOT_ID}`) ||
            target.closest(`#${M365_TIMELINE_TOOLTIP_ID}`))
        );
      })
    ) {
      return;
    }

    scheduleTimelineRefresh();
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function removeM365TimelineUi(): void {
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  observer?.disconnect();
  observer = null;

  const root = document.getElementById(M365_TIMELINE_ROOT_ID);
  if (root) {
    detachTimelineListeners(root);
    root.remove();
  }

  document.getElementById(M365_TIMELINE_TOOLTIP_ID)?.remove();
  document.getElementById(M365_TIMELINE_STYLE_ID)?.remove();
}

function applyM365Timeline(): void {
  if (!timelineEnabled) {
    removeM365TimelineUi();
    return;
  }

  ensureM365TimelineStyle();
  const root = ensureM365TimelineRoot();
  ensureM365TimelineTooltip();
  attachTimelineListeners(root);
  try {
    renderM365TimelineMarkers();
  } catch (error) {
    console.warn('[Gemini Voyager] M365 timeline render failed:', error);
  }
  ensureTimelineObserver();
}

function readStoredM365TimelineSettings(): void {
  try {
    chrome.storage?.sync?.get(
      {
        [M365_TIMELINE_ENABLED_KEY]: true,
        [M365_TIMELINE_SCROLL_MODE_KEY]: M365_TIMELINE_DEFAULT_SCROLL_MODE,
      },
      (res) => {
        timelineEnabled = res?.[M365_TIMELINE_ENABLED_KEY] !== false;
        timelineScrollMode = normalizeM365TimelineScrollMode(res?.[M365_TIMELINE_SCROLL_MODE_KEY]);
        applyM365Timeline();
      },
    );
  } catch {}
}

function ensureStorageListener(): void {
  if (storageListener) return;

  storageListener = (changes, area) => {
    if (area !== 'sync') return;

    if (changes[M365_TIMELINE_ENABLED_KEY]) {
      timelineEnabled = changes[M365_TIMELINE_ENABLED_KEY].newValue !== false;
    }

    if (changes[M365_TIMELINE_SCROLL_MODE_KEY]) {
      timelineScrollMode = normalizeM365TimelineScrollMode(
        changes[M365_TIMELINE_SCROLL_MODE_KEY].newValue,
      );
    }

    if (changes[M365_TIMELINE_ENABLED_KEY] || changes[M365_TIMELINE_SCROLL_MODE_KEY]) {
      applyM365Timeline();
    }
  };

  chrome.storage?.onChanged?.addListener(storageListener);
}

export function stopM365Timeline(): void {
  removeM365TimelineUi();
  activeMarkerKey = null;
  timelineConversationKey = null;
  timelineEntries = [];
  timelineDeps = getDefaultDeps();
  timelineEnabled = true;
  timelineScrollMode = M365_TIMELINE_DEFAULT_SCROLL_MODE;
  if (storageListener) {
    chrome.storage?.onChanged?.removeListener(storageListener);
    storageListener = null;
  }
}

export function startM365Timeline(deps: M365TimelineDeps = {}): void {
  timelineDeps = { ...getDefaultDeps(), ...deps };
  applyM365Timeline();
  readStoredM365TimelineSettings();
  ensureStorageListener();
}
