import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Popup from '../Popup';

const mocks = vi.hoisted(() => ({
  tabsQuery: vi.fn(),
  syncSet: vi.fn(),
  syncGet: vi.fn(),
  localGet: vi.fn(),
  localSet: vi.fn(),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    tabs: {
      query: mocks.tabsQuery,
      sendMessage: vi.fn(),
    },
    storage: {
      sync: {
        get: mocks.syncGet,
        set: mocks.syncSet,
      },
      local: {
        get: mocks.localGet,
        set: mocks.localSet,
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    permissions: {
      contains: vi.fn().mockResolvedValue(true),
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true),
    },
    i18n: {
      getUILanguage: vi.fn(() => 'en'),
    },
  },
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    setLanguage: vi.fn(),
    t: (key: string) => key,
  }),
}));

vi.mock('@/core/utils/browser', () => ({
  getModifierKey: () => 'Ctrl',
  isSafari: () => false,
  shouldShowSafariUpdateReminder: () => false,
}));

vi.mock('@/core/utils/updateReminder', () => ({
  shouldShowUpdateReminderForCurrentVersion: () => false,
}));

function createChromeMock() {
  return {
    runtime: {
      getManifest: vi.fn(() => ({ version: '1.3.6', update_url: 'https://store.invalid' })),
      sendMessage: vi.fn().mockResolvedValue({ ok: true }),
      lastError: null,
      id: 'test-extension-id',
    },
    storage: {
      sync: {
        get: vi.fn((defaults: unknown, callback?: (res: unknown) => void) => {
          const result = typeof defaults === 'string' ? {} : (defaults ?? {});
          if (callback) {
            callback(result);
            return undefined;
          }
          return Promise.resolve(result);
        }),
        set: vi.fn(),
        remove: vi.fn(),
        clear: vi.fn(),
      },
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    tabs: {
      query: mocks.tabsQuery,
      sendMessage: vi.fn(),
    },
  } as unknown as typeof chrome;
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('Popup M365 settings', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.chrome = createChromeMock();
    mocks.tabsQuery.mockResolvedValue([{ id: 1, url: 'https://m365.cloud.microsoft/chat' }]);
    mocks.syncSet.mockResolvedValue(undefined);
    mocks.syncGet.mockImplementation(async (defaults: unknown) => defaults ?? {});
    mocks.localGet.mockResolvedValue({});
    mocks.localSet.mockResolvedValue(undefined);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  async function renderPopup(): Promise<void> {
    await act(async () => {
      root = createRoot(container);
      root.render(<Popup />);
    });
    await flushMicrotasks();
    await flushMicrotasks();
  }

  it('shows M365-only settings on m365.cloud.microsoft', async () => {
    await renderPopup();

    expect(container.textContent).toContain('M365 Copilot Settings');
    expect(container.textContent).toContain('Enable timeline');
    expect(container.textContent).toContain('chatWidth');
    expect(container.textContent).not.toContain('folderOptions');
  });

  it('writes M365 keys when M365 controls change', async () => {
    await renderPopup();

    const flowButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'flow',
    );
    const jumpButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'jump',
    );
    expect(flowButton).toBeTruthy();
    expect(jumpButton).toBeTruthy();

    await act(async () => {
      jumpButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mocks.syncSet).toHaveBeenCalledWith({ gvM365TimelineScrollMode: 'jump' });

    const sliders = container.querySelectorAll<HTMLInputElement>('input[type="range"]');
    expect(sliders).toHaveLength(1);
    sliders[0].value = '88';
    await act(async () => {
      sliders[0].dispatchEvent(new Event('input', { bubbles: true }));
      sliders[0].dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    expect(chrome.storage.sync.set).toHaveBeenCalledWith({ gvM365ChatWidthPercent: 88 });
    expect(chrome.storage.sync.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ geminiChatWidth: expect.anything() }),
    );
  });

  it('keeps the existing Gemini settings view on Gemini tabs', async () => {
    mocks.tabsQuery.mockResolvedValue([{ id: 1, url: 'https://gemini.google.com/app' }]);

    await renderPopup();

    expect(container.textContent).toContain('timelineOptions');
    expect(container.textContent).not.toContain('M365 Copilot Settings');
  });
});
