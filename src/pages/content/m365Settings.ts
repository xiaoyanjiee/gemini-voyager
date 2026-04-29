export type M365TimelineScrollMode = 'jump' | 'flow';

export const M365_CHAT_WIDTH_ENABLED_KEY = 'gvM365ChatWidthEnabled';
export const M365_CHAT_WIDTH_PERCENT_KEY = 'gvM365ChatWidthPercent';
export const M365_TIMELINE_ENABLED_KEY = 'gvM365TimelineEnabled';
export const M365_TIMELINE_SCROLL_MODE_KEY = 'gvM365TimelineScrollMode';
export const M365_TIMELINE_POSITION_KEY = 'gvM365TimelinePosition';

export const M365_CHAT_WIDTH_PERCENT = {
  min: 30,
  max: 100,
  defaultValue: 75,
} as const;

export const M365_TIMELINE_DEFAULT_SCROLL_MODE: M365TimelineScrollMode = 'flow';

export function clampM365ChatWidthPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return M365_CHAT_WIDTH_PERCENT.defaultValue;
  }

  return Math.min(
    M365_CHAT_WIDTH_PERCENT.max,
    Math.max(M365_CHAT_WIDTH_PERCENT.min, Math.round(value)),
  );
}

export function normalizeM365TimelineScrollMode(value: unknown): M365TimelineScrollMode {
  return value === 'jump' || value === 'flow' ? value : M365_TIMELINE_DEFAULT_SCROLL_MODE;
}
