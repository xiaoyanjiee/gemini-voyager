import { extractM365CanonicalConversation } from './m365ChatExtractor';
import type { CanonicalConversation } from './m365ConversationTypes';
import { type M365TimelineIndexItem, M365TimelineService } from './m365FeatureServices';

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

let observer: MutationObserver | null = null;
let refreshTimer: number | null = null;
let activeMarkerId: string | null = null;
let timelineDeps: Required<M365TimelineDeps> = getDefaultDeps();

function getDefaultDeps(): Required<M365TimelineDeps> {
  return {
    extractConversation: extractM365CanonicalConversation,
    buildIndex: M365TimelineService.buildIndex.bind(M365TimelineService),
    scrollToElement: (element: Element) => {
      element.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
  top: 184px;
  right: 18px;
  bottom: 88px;
  z-index: 2147483645;
  width: 24px;
  pointer-events: none;
  font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
}

.gv-m365-timeline-rail {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 999px;
  pointer-events: auto;
}

.gv-m365-timeline-rail::before {
  content: "";
  position: absolute;
  inset: 0 11px;
  border-radius: 999px;
  background: rgba(97, 97, 97, 0.22);
}

.gv-m365-timeline-marker {
  position: absolute;
  left: 50%;
  width: 12px;
  height: 12px;
  padding: 0;
  border: 2px solid #ffffff;
  border-radius: 50%;
  background: #6264a7;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.24);
  cursor: pointer;
  transform: translate(-50%, -50%);
}

.gv-m365-timeline-marker:hover,
.gv-m365-timeline-marker:focus-visible,
.${M365_TIMELINE_ACTIVE_CLASS} {
  background: #0f6cbd;
  outline: none;
  transform: translate(-50%, -50%) scale(1.2);
}

#${M365_TIMELINE_TOOLTIP_ID} {
  position: fixed;
  z-index: 2147483646;
  max-width: 280px;
  padding: 7px 9px;
  border: 1px solid rgba(60, 64, 67, 0.18);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
  color: #242424;
  font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 12px;
  line-height: 1.35;
  overflow-wrap: anywhere;
  pointer-events: none;
}

#${M365_TIMELINE_TOOLTIP_ID}[hidden] {
  display: none;
}

@media (prefers-color-scheme: dark) {
  .gv-m365-timeline-rail::before {
    background: rgba(255, 255, 255, 0.24);
  }

  .gv-m365-timeline-marker {
    border-color: #202020;
    background: #8b8cc7;
  }

  .gv-m365-timeline-marker:hover,
  .gv-m365-timeline-marker:focus-visible,
  .${M365_TIMELINE_ACTIVE_CLASS} {
    background: #60cdff;
  }

  #${M365_TIMELINE_TOOLTIP_ID} {
    border-color: rgba(255, 255, 255, 0.16);
    background: rgba(32, 32, 32, 0.96);
    color: #f5f5f5;
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

function getUserTimelineItems(): M365TimelineIndexItem[] {
  const conversation = timelineDeps.extractConversation();
  return timelineDeps.buildIndex(conversation).filter((item) => item.role === 'user');
}

function renderM365TimelineMarkers(): void {
  const root = ensureM365TimelineRoot();
  const rail = getRail(root);
  const items = getUserTimelineItems();
  const nextIds = items.map((item) => item.id).join('|');

  if (rail.dataset.gvM365TimelineIds === nextIds) return;

  rail.dataset.gvM365TimelineIds = nextIds;
  rail.replaceChildren(
    ...items.map((item, index) => createTimelineMarker(item, index, items.length)),
  );
  if (activeMarkerId && !items.some((item) => item.id === activeMarkerId)) {
    activeMarkerId = null;
  }
  updateActiveMarker();
}

function createTimelineMarker(
  item: M365TimelineIndexItem,
  markerIndex: number,
  markerCount: number,
): HTMLButtonElement {
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.className = 'gv-m365-timeline-marker';
  marker.dataset.gvM365TimelineMarker = 'true';
  marker.dataset.gvM365TimelineId = item.id;
  marker.dataset.gvM365TimelineIndex = String(item.index);
  marker.dataset.gvM365TimelineSummary = normalizeTimelineSummary(item.summary);
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
  const id = marker.dataset.gvM365TimelineId;
  if (!id) return null;

  return getUserTimelineItems().find((item) => item.id === id) ?? null;
}

function handleTimelineClick(event: Event): void {
  const marker = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    '[data-gv-m365-timeline-marker]',
  );
  if (!marker) return;

  const item = findTimelineItem(marker);
  if (!item) return;

  activeMarkerId = item.id;
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
  const tooltipWidth = 280;
  const viewportPadding = 8;

  tooltip.textContent = summary;
  tooltip.hidden = false;

  const left = Math.max(viewportPadding, markerRect.left - tooltipWidth - 12);
  const top = Math.max(
    viewportPadding,
    Math.min(window.innerHeight - viewportPadding - 48, markerRect.top - 10),
  );

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
      Boolean(activeMarkerId && marker.dataset.gvM365TimelineId === activeMarkerId),
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

export function stopM365Timeline(): void {
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  observer?.disconnect();
  observer = null;
  activeMarkerId = null;
  timelineDeps = getDefaultDeps();

  const root = document.getElementById(M365_TIMELINE_ROOT_ID);
  if (root) {
    detachTimelineListeners(root);
    root.remove();
  }

  document.getElementById(M365_TIMELINE_TOOLTIP_ID)?.remove();
  document.getElementById(M365_TIMELINE_STYLE_ID)?.remove();
}

export function startM365Timeline(deps: M365TimelineDeps = {}): void {
  timelineDeps = { ...getDefaultDeps(), ...deps };
  ensureM365TimelineStyle();
  const root = ensureM365TimelineRoot();
  ensureM365TimelineTooltip();
  attachTimelineListeners(root);
  try {
    renderM365TimelineMarkers();
  } catch (error) {
    console.warn('[Gemini Voyager] M365 timeline initial render failed:', error);
  }
  ensureTimelineObserver();
}
