import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startVoyagerDock, stopVoyagerDock } from '../VoyagerDock';

describe('VoyagerDock', () => {
  beforeEach(() => {
    const syncStore: Record<string, unknown> = {};
    const localStore: Record<string, unknown> = {};
    Object.assign(chrome.storage, {
      local: {
        get: vi.fn((_keys, callback) => callback?.({ ...localStore })),
        set: vi.fn((items, callback) => {
          Object.assign(localStore, items);
          callback?.();
        }),
        remove: vi.fn((_keys, callback) => callback?.()),
        clear: vi.fn((callback) => callback?.()),
      },
    });
    const syncGet = chrome.storage.sync.get as unknown as ReturnType<typeof vi.fn>;
    const syncSet = chrome.storage.sync.set as unknown as ReturnType<typeof vi.fn>;
    syncGet.mockImplementation((_keys, callback) => {
      callback?.({ ...syncStore });
    });
    syncSet.mockImplementation((items, callback) => {
      Object.assign(syncStore, items);
      callback?.();
    });
  });

  afterEach(() => {
    stopVoyagerDock();
    document.body.innerHTML = '';
  });

  it('mounts once in an isolated shadow root and cleans up', async () => {
    await startVoyagerDock();
    await startVoyagerDock();

    const host = document.getElementById('gv-m365-voyager-dock');
    expect(document.querySelectorAll('#gv-m365-voyager-dock')).toHaveLength(1);
    expect(host?.shadowRoot).not.toBeNull();
    expect(host?.shadowRoot?.querySelector('.panel')?.hasAttribute('hidden')).toBe(true);

    host?.shadowRoot?.querySelector<HTMLButtonElement>('.launcher')?.click();
    expect(host?.shadowRoot?.querySelector('.panel')?.hasAttribute('hidden')).toBe(false);

    stopVoyagerDock();
    expect(document.getElementById('gv-m365-voyager-dock')).toBeNull();
  });

  it('uses Fluent-style solid colors without gradients or emoji', async () => {
    await startVoyagerDock();
    const text = document.getElementById('gv-m365-voyager-dock')?.shadowRoot?.textContent ?? '';

    expect(text).not.toContain('linear-gradient');
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('uses inline folder forms instead of blocking dialogs', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    await startVoyagerDock();
    const root = document.getElementById('gv-m365-voyager-dock')?.shadowRoot;
    root?.querySelector<HTMLButtonElement>('[data-section="organize"]')?.click();
    await vi.waitFor(() =>
      expect(root?.querySelector('input[placeholder="Folder name"]')).not.toBeNull(),
    );

    const input = root?.querySelector<HTMLInputElement>('input[placeholder="Folder name"]');
    if (input) input.value = 'Test folder';
    root
      ?.querySelector<HTMLFormElement>('.folder-form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(root?.querySelector('.folder-list')?.textContent).toContain('Test folder'),
    );
    expect(root?.querySelector('.folder-list')?.textContent).toContain('Add subfolder');
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('supports prompt editing and deletion', async () => {
    await startVoyagerDock();
    const root = document.getElementById('gv-m365-voyager-dock')?.shadowRoot;
    root?.querySelector<HTMLButtonElement>('[data-section="prompts"]')?.click();
    await vi.waitFor(() =>
      expect(root?.querySelector('input[placeholder="Prompt title"]')).not.toBeNull(),
    );

    const title = root?.querySelector<HTMLInputElement>('input[placeholder="Prompt title"]');
    const text = root?.querySelector<HTMLTextAreaElement>('textarea[placeholder="Prompt text"]');
    if (title) title.value = 'Temporary';
    if (text) text.value = 'Temporary text';
    root
      ?.querySelector<HTMLFormElement>('.prompt-form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(root?.querySelector('.prompt-list')?.textContent).toContain('Temporary'),
    );

    const editButton = [
      ...(root?.querySelectorAll<HTMLButtonElement>('.prompt-list button') ?? []),
    ].find((button) => button.textContent === 'Edit');
    editButton?.click();
    await vi.waitFor(() =>
      expect(root?.querySelector('.prompt-form')?.textContent).toContain('Update prompt'),
    );
    root?.querySelector<HTMLButtonElement>('.prompt-form button[type="button"]')?.click();
    await vi.waitFor(() => expect(root?.querySelector('.prompt-list')).not.toBeNull());

    const deleteButton = [
      ...(root?.querySelectorAll<HTMLButtonElement>('.prompt-list button') ?? []),
    ].find((button) => button.textContent === 'Delete');
    deleteButton?.click();
    await vi.waitFor(() =>
      expect(root?.querySelector('.prompt-list')?.textContent).toContain('No prompts found'),
    );
  });

  it('applies and cleans up dock position and input collapse settings', async () => {
    await startVoyagerDock();
    const host = document.getElementById('gv-m365-voyager-dock');
    const root = host?.shadowRoot;
    root?.querySelector<HTMLButtonElement>('[data-section="appearance"]')?.click();
    await vi.waitFor(() =>
      expect(root?.querySelector('select[aria-label="Timeline and dock position"]')).not.toBeNull(),
    );

    const position = root?.querySelector<HTMLSelectElement>(
      'select[aria-label="Timeline and dock position"]',
    );
    if (position) position.value = 'left';
    position?.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(host?.dataset.position).toBe('left'));
    const collapse = [
      ...(root?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? []),
    ].find((input) => input.parentElement?.textContent?.includes('Collapse M365 input area'));
    collapse?.click();

    await vi.waitFor(() =>
      expect(document.documentElement.classList.contains('gv-m365-input-collapsed')).toBe(true),
    );
    stopVoyagerDock();
    expect(document.documentElement.classList.contains('gv-m365-input-collapsed')).toBe(false);
  });
});
