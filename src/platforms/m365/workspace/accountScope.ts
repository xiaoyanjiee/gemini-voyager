const ACCOUNT_HINT_SELECTORS = [
  '[data-tid="me-control-avatar-trigger"]',
  '[aria-label*="account" i]',
  '[aria-label*="profile" i]',
  '[title*="account" i]',
] as const;

function hashAccountHint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function resolveM365AccountScope(doc: Document = document): string {
  for (const selector of ACCOUNT_HINT_SELECTORS) {
    const element = doc.querySelector(selector);
    const hint =
      element?.getAttribute('aria-label')?.trim() || element?.getAttribute('title')?.trim() || '';
    if (hint) return `m365:${hashAccountHint(hint.toLowerCase())}`;
  }
  return 'm365:unknown';
}
