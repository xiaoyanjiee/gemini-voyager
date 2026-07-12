import { logger } from '@/core/services/LoggerService';
import { settingsV2Repository } from '@/core/v2/repositories';
import type { SettingsV2 } from '@/core/v2/schemas';
import { extractM365ConversationCapture } from '@/pages/content/m365ChatExtractor';

import { ConversationSession } from '../conversation/ConversationSession';
import {
  containsFormula,
  copyMessage,
  insertIntoM365Editor,
  quoteMessageInM365Editor,
} from '../conversation/messageActions';
import type { ConversationSnapshot, SnapshotMessage } from '../conversation/model';
import { M365ExportV2Service } from '../export/M365ExportV2Service';
import { M365WorkspaceService } from '../workspace/M365WorkspaceService';
import { resolveM365AccountScope } from '../workspace/accountScope';

const HOST_ID = 'gv-m365-voyager-dock';
const INPUT_COLLAPSE_STYLE_ID = 'gv-m365-input-collapse-style';
const INPUT_COLLAPSE_CLASS = 'gv-m365-input-collapsed';
const REFRESH_DELAY_MS = 180;
const ROOT_LOOKUP_INTERVAL_MS = 1000;
const dockLogger = logger.createChild('VoyagerDock');

type DockSection = 'timeline' | 'organize' | 'prompts' | 'export' | 'appearance';

class VoyagerDockController {
  private readonly abortController = new AbortController();
  private readonly session = new ConversationSession();
  private readonly workspace = new M365WorkspaceService();
  private readonly accountScope = resolveM365AccountScope();
  private readonly selectedMessageIds = new Set<string>();
  private readonly host = document.createElement('div');
  private readonly shadow = this.host.attachShadow({ mode: 'open' });
  private observer: MutationObserver | null = null;
  private observedConversationRoot: Element | null = null;
  private rootLookupTimer: number | null = null;
  private refreshTimer: number | null = null;
  private snapshot: ConversationSnapshot | null = null;
  private section: DockSection = 'timeline';
  private showUser = true;
  private showAssistant = true;
  private search = '';
  private editingPromptId: string | null = null;

  async start(): Promise<void> {
    this.host.id = HOST_ID;
    this.host.dataset.gvM365Ui = 'true';
    this.renderShell();
    document.documentElement.appendChild(this.host);
    this.bindEvents();
    await this.refresh();
    await this.applyAppearanceSettings();
    this.attachConversationObserver();
  }

  dispose(): void {
    this.abortController.abort();
    this.observer?.disconnect();
    if (this.rootLookupTimer !== null) window.clearInterval(this.rootLookupTimer);
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.session.reset();
    document.documentElement.classList.remove(INPUT_COLLAPSE_CLASS);
    document.getElementById(INPUT_COLLAPSE_STYLE_ID)?.remove();
    this.host.remove();
  }

  private renderShell(): void {
    this.shadow.innerHTML = `
      <style>${DOCK_CSS}</style>
      <button class="launcher" type="button" aria-expanded="false" aria-controls="panel">Voyager</button>
      <aside id="panel" class="panel" aria-label="Voyager M365 controls" hidden>
        <header><strong>Voyager</strong><button type="button" data-action="close" aria-label="Close">Close</button></header>
        <nav aria-label="Voyager sections">
          <button type="button" data-section="timeline" aria-current="page">Timeline</button>
          <button type="button" data-section="organize">Organize</button>
          <button type="button" data-section="prompts">Prompts</button>
          <button type="button" data-section="export">Export</button>
          <button type="button" data-section="appearance">Appearance</button>
        </nav>
        <main tabindex="-1"></main>
        <div class="status" role="status" aria-live="polite"></div>
      </aside>`;
  }

  private bindEvents(): void {
    const signal = this.abortController.signal;
    this.shadow.querySelector('.launcher')?.addEventListener('click', () => this.togglePanel(), {
      signal,
    });
    this.shadow
      .querySelector('[data-action="close"]')
      ?.addEventListener('click', () => this.togglePanel(false), {
        signal,
      });
    this.shadow.querySelector('nav')?.addEventListener(
      'click',
      (event) => {
        const button = (event.target as Element).closest<HTMLButtonElement>('[data-section]');
        if (!button) return;
        this.section = button.dataset.section as DockSection;
        this.shadow
          .querySelectorAll('[data-section]')
          .forEach((item) => item.toggleAttribute('aria-current', item === button));
        void this.renderSection();
      },
      { signal },
    );
  }

  private togglePanel(force?: boolean): void {
    const panel = this.shadow.querySelector<HTMLElement>('.panel');
    const launcher = this.shadow.querySelector<HTMLButtonElement>('.launcher');
    if (!panel || !launcher) return;
    const open = force ?? panel.hidden;
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) void this.renderSection();
  }

  private attachConversationObserver(): void {
    const attach = (): boolean => {
      if (this.observedConversationRoot?.isConnected && this.observer) return true;
      const root = this.findConversationRoot();
      if (!root) return false;
      if (root === this.observedConversationRoot && this.observer) return true;
      this.observer?.disconnect();
      this.observer = new MutationObserver(() => this.scheduleRefresh());
      this.observer.observe(root, { childList: true, characterData: true, subtree: true });
      this.observedConversationRoot = root;
      this.scheduleRefresh();
      return true;
    };
    attach();
    this.rootLookupTimer = window.setInterval(() => {
      attach();
    }, ROOT_LOOKUP_INTERVAL_MS);
  }

  private findConversationRoot(): Element | null {
    const messageClass = document.querySelector(
      '[class*="fai-UserMessage"], [class*="fai-CopilotMessage"]',
    );
    const message =
      messageClass?.closest('[role="article"]') ??
      document.querySelector('[role="feed"] [role="article"]');
    return (
      message?.closest('[role="feed"], [role="log"]') ??
      document.querySelector('[role="feed"], [role="log"]')
    );
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, REFRESH_DELAY_MS);
  }

  private async refresh(): Promise<void> {
    try {
      const capture = extractM365ConversationCapture();
      capture.snapshot.accountScope = this.accountScope;
      this.snapshot = this.session.merge(capture.snapshot, capture.domIndex);
      if (this.section === 'timeline' && !this.isPanelHidden()) await this.renderTimeline();
    } catch (error) {
      dockLogger.debug('Conversation is not ready', { error });
    }
  }

  private isPanelHidden(): boolean {
    return this.shadow.querySelector<HTMLElement>('.panel')?.hidden !== false;
  }

  private async renderSection(): Promise<void> {
    switch (this.section) {
      case 'timeline':
        await this.renderTimeline();
        break;
      case 'organize':
        await this.renderOrganize();
        break;
      case 'prompts':
        await this.renderPrompts();
        break;
      case 'export':
        this.renderExport();
        break;
      case 'appearance':
        await this.renderAppearance();
        break;
    }
  }

  private getMain(): HTMLElement {
    const main = this.shadow.querySelector<HTMLElement>('main');
    if (!main) throw new Error('VoyagerDock main region is missing');
    main.replaceChildren();
    return main;
  }

  private async renderTimeline(): Promise<void> {
    const main = this.getMain();
    const starredMessageIds = new Set(
      (await this.workspace.view(this.accountScope)).starred
        .filter((record) => record.conversationId === this.snapshot?.conversationId)
        .map((record) => record.messageId),
    );
    const controls = document.createElement('div');
    controls.className = 'filters';
    const search = this.input('Search messages', this.search);
    search.type = 'search';
    search.addEventListener('input', () => {
      this.search = search.value.toLowerCase();
      void this.renderTimeline();
    });
    controls.append(
      search,
      this.filterCheckbox('User', 'user'),
      this.filterCheckbox('Assistant', 'assistant'),
    );
    main.append(controls);

    const list = document.createElement('div');
    list.className = 'message-list';
    list.setAttribute('role', 'list');
    const messages = (this.snapshot?.messages ?? []).filter(
      (message) =>
        (message.role === 'user' ? this.showUser : this.showAssistant) &&
        (!this.search || message.plainText.toLowerCase().includes(this.search)),
    );
    if (messages.length === 0) list.append(this.empty('No matching messages'));
    messages.forEach((message) =>
      list.append(this.timelineItem(message, starredMessageIds.has(message.id))),
    );
    main.append(list);
  }

  private filterCheckbox(label: string, role: 'user' | 'assistant'): HTMLLabelElement {
    const wrapper = document.createElement('label');
    wrapper.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = role === 'user' ? this.showUser : this.showAssistant;
    input.addEventListener('change', () => {
      if (role === 'user') this.showUser = input.checked;
      else this.showAssistant = input.checked;
      void this.renderTimeline();
    });
    wrapper.append(input, document.createTextNode(label));
    return wrapper;
  }

  private timelineItem(message: SnapshotMessage, isStarred: boolean): HTMLElement {
    const item = document.createElement('article');
    item.className = 'message-item';
    item.setAttribute('role', 'listitem');
    const heading = document.createElement('div');
    heading.className = 'message-heading';
    const selection = document.createElement('input');
    selection.type = 'checkbox';
    selection.checked = this.selectedMessageIds.has(message.id);
    selection.setAttribute('aria-label', `Select message ${message.index + 1}`);
    selection.addEventListener('change', () => {
      if (selection.checked) this.selectedMessageIds.add(message.id);
      else this.selectedMessageIds.delete(message.id);
    });
    const jump = this.button(`${message.index + 1}. ${message.role}`, () => {
      this.session.domIndex
        .get(message.id)
        ?.source.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    jump.className = 'jump';
    const star = this.button(isStarred ? 'Unstar' : 'Star', async () => {
      if (!this.snapshot) return;
      const starred = await this.workspace.toggleStar(
        this.accountScope,
        this.snapshot.conversationId,
        message.id,
        message.plainText,
      );
      star.textContent = starred ? 'Unstar' : 'Star';
      star.setAttribute('aria-pressed', String(starred));
      this.status(starred ? 'Message starred' : 'Star removed');
    });
    star.setAttribute('aria-pressed', String(isStarred));
    heading.append(selection, jump, star);
    const preview = document.createElement('p');
    preview.textContent = message.plainText.slice(0, 240) || 'Empty message';
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      this.button('Copy text', () => this.run(() => copyMessage(message, 'plain'), 'Copied text')),
      this.button('Copy Markdown', () =>
        this.run(() => copyMessage(message, 'markdown'), 'Copied Markdown'),
      ),
      this.button('Quote', () => {
        this.status(quoteMessageInM365Editor(message) ? 'Quote inserted' : 'M365 editor not found');
      }),
    );
    if (containsFormula(message)) {
      actions.append(
        this.button('Copy formula', () =>
          this.run(() => copyMessage(message, 'formula'), 'Copied formula'),
        ),
      );
    }
    item.append(heading, preview, actions);
    return item;
  }

  private async renderOrganize(): Promise<void> {
    const main = this.getMain();
    const workspaceActions = document.createElement('div');
    workspaceActions.className = 'actions';
    workspaceActions.append(
      this.button('Export workspace', async () => {
        const serialized = await this.workspace.exportWorkspace(this.accountScope);
        const url = URL.createObjectURL(new Blob([serialized], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'voyager-m365-workspace-v2.json';
        anchor.click();
        URL.revokeObjectURL(url);
        this.status('Workspace export started');
      }),
    );
    const importLabel = document.createElement('label');
    importLabel.className = 'file-button';
    importLabel.textContent = 'Import workspace';
    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = 'application/json,.json';
    importInput.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      const serialized = await file.text();
      const imported = await this.run(
        () => this.workspace.importWorkspace(this.accountScope, serialized),
        'Workspace imported',
      );
      importInput.value = '';
      if (imported !== null) await this.renderOrganize();
    });
    importLabel.append(importInput);
    workspaceActions.append(importLabel);
    main.append(workspaceActions);

    if (this.snapshot) {
      const current = document.createElement('div');
      current.className = 'current-conversation';
      current.draggable = true;
      current.textContent = `Current conversation: ${this.snapshot.title || 'Untitled'}`;
      current.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData('text/plain', this.snapshot?.conversationId ?? '');
      });
      main.append(current);
    }
    const createForm = document.createElement('form');
    createForm.className = 'folder-form';
    const folderName = this.input('Folder name');
    const createFolder = this.button('Create folder');
    createFolder.type = 'submit';
    createForm.append(folderName, createFolder);
    createForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!folderName.value.trim()) return;
      const created = await this.run(
        () => this.workspace.createFolder(this.accountScope, folderName.value, null),
        'Folder created',
      );
      if (created) await this.renderOrganize();
    });
    main.append(createForm);
    const view = await this.workspace.view(this.accountScope);
    const currentConversation = view.conversations.find(
      (conversation) => conversation.id === this.snapshot?.conversationId,
    );
    if (currentConversation?.folderId) {
      main.append(
        this.button('Remove current chat from folder', async () => {
          const moved = await this.fileCurrentConversation(null);
          if (moved !== null) await this.renderOrganize();
        }),
      );
    }
    const list = document.createElement('div');
    list.className = 'folder-list';
    const roots = view.folders.filter((folder) => folder.parentId === null);
    if (roots.length === 0) list.append(this.empty('No folders yet'));
    for (const folder of roots) {
      const row = this.folderRow(
        folder.id,
        folder.name,
        false,
        currentConversation?.folderId === folder.id,
      );
      list.append(row);
      view.folders
        .filter((child) => child.parentId === folder.id)
        .forEach((child) =>
          list.append(
            this.folderRow(child.id, child.name, true, currentConversation?.folderId === child.id),
          ),
        );
    }
    main.append(list);
  }

  private folderRow(id: string, name: string, child: boolean, active: boolean): HTMLElement {
    const entry = document.createElement('div');
    entry.className = child ? 'folder-entry child' : 'folder-entry';
    entry.classList.toggle('active', active);
    const row = document.createElement('div');
    row.className = 'folder';
    row.addEventListener('dragover', (event) => event.preventDefault());
    row.addEventListener('drop', async (event) => {
      event.preventDefault();
      if (
        !this.snapshot ||
        event.dataTransfer?.getData('text/plain') !== this.snapshot.conversationId
      )
        return;
      const moved = await this.fileCurrentConversation(id);
      if (moved !== null) await this.renderOrganize();
    });
    const label = document.createElement('span');
    label.textContent = name;
    const move = this.button('File chat', async () => {
      const moved = await this.fileCurrentConversation(id);
      if (moved !== null) await this.renderOrganize();
    });
    const remove = this.button('Delete', async () => {
      const deleted = await this.run(
        () => this.workspace.deleteFolder(this.accountScope, id),
        'Folder deleted',
      );
      if (deleted !== null) await this.renderOrganize();
    });
    remove.className = 'danger';
    row.append(label, move, remove);
    entry.append(row);
    if (!child) {
      const childForm = document.createElement('form');
      childForm.className = 'folder-form child-form';
      const childName = this.input(`Subfolder name for ${name}`);
      const addChild = this.button('Add subfolder');
      addChild.type = 'submit';
      childForm.append(childName, addChild);
      childForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!childName.value.trim()) return;
        const created = await this.run(
          () => this.workspace.createFolder(this.accountScope, childName.value, id),
          'Subfolder created',
        );
        if (created) await this.renderOrganize();
      });
      entry.append(childForm);
    }
    return entry;
  }

  private async fileCurrentConversation(folderId: string | null): Promise<void | null> {
    if (!this.snapshot) return null;
    return this.run(
      () =>
        this.workspace.moveConversation(
          this.accountScope,
          {
            id: this.snapshot!.conversationId,
            title: this.snapshot!.title,
            url: this.snapshot!.url,
          },
          folderId,
        ),
      folderId ? 'Conversation filed' : 'Conversation removed from folder',
    );
  }

  private async renderPrompts(): Promise<void> {
    const main = this.getMain();
    const prompts = (await this.workspace.view(this.accountScope)).prompts;
    const editingPrompt = prompts.find((prompt) => prompt.id === this.editingPromptId) ?? null;
    const search = this.input('Search prompts');
    const form = document.createElement('form');
    form.className = 'prompt-form';
    const title = this.input('Prompt title', editingPrompt?.title ?? '');
    const tags = this.input('Tags, comma separated', editingPrompt?.tags.join(', ') ?? '');
    const text = document.createElement('textarea');
    text.placeholder = 'Prompt text';
    text.rows = 5;
    text.value = editingPrompt?.text ?? '';
    const save = this.button(editingPrompt ? 'Update prompt' : 'Save prompt');
    save.type = 'submit';
    form.append(title, tags, text, save);
    if (editingPrompt) {
      form.append(
        this.button('Cancel edit', () => {
          this.editingPromptId = null;
          return this.renderPrompts();
        }),
      );
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const saved = await this.run(
        () =>
          this.workspace.savePrompt(this.accountScope, {
            id: editingPrompt?.id,
            title: title.value,
            text: text.value,
            tags: tags.value.split(','),
          }),
        editingPrompt ? 'Prompt updated' : 'Prompt saved',
      );
      if (saved) {
        this.editingPromptId = null;
        await this.renderPrompts();
      }
    });
    main.append(search, form);
    const list = document.createElement('div');
    list.className = 'prompt-list';
    const renderList = async () => {
      list.replaceChildren();
      const query = search.value.toLowerCase();
      const filteredPrompts = prompts.filter((prompt) =>
        `${prompt.title} ${prompt.text} ${prompt.tags.join(' ')}`.toLowerCase().includes(query),
      );
      if (filteredPrompts.length === 0) list.append(this.empty('No prompts found'));
      filteredPrompts.forEach((prompt) => {
        const item = document.createElement('article');
        const heading = document.createElement('strong');
        heading.textContent = prompt.title || 'Untitled prompt';
        const preview = document.createElement('p');
        preview.textContent = prompt.text.slice(0, 180);
        const actions = document.createElement('div');
        actions.className = 'actions';
        actions.append(
          this.button('Insert', () => {
            this.status(
              insertIntoM365Editor(prompt.text) ? 'Prompt inserted' : 'M365 editor not found',
            );
          }),
          this.button('Edit', () => {
            this.editingPromptId = prompt.id;
            return this.renderPrompts();
          }),
          this.button('Delete', async () => {
            const deleted = await this.run(
              () => this.workspace.deletePrompt(this.accountScope, prompt.id),
              'Prompt deleted',
            );
            if (deleted !== null) {
              if (this.editingPromptId === prompt.id) this.editingPromptId = null;
              await this.renderPrompts();
            }
          }),
        );
        item.append(heading, preview, actions);
        list.append(item);
      });
    };
    search.addEventListener('input', () => void renderList());
    await renderList();
    main.append(list);
  }

  private renderExport(): void {
    const main = this.getMain();
    const description = document.createElement('p');
    description.textContent = 'Export all messages, or only messages selected in Timeline.';
    main.append(description);
    M365ExportV2Service.formats().forEach((format) => {
      main.append(
        this.button(`Export ${format.toUpperCase()}`, async () => {
          if (!this.snapshot) return;
          const selected = this.selectedMessageIds.size > 0 ? this.selectedMessageIds : undefined;
          const result = await M365ExportV2Service.export(this.snapshot, format, selected);
          this.status(
            result.success
              ? `${format.toUpperCase()} export started`
              : result.error || 'Export failed',
          );
        }),
      );
    });
  }

  private async renderAppearance(): Promise<void> {
    const main = this.getMain();
    const settings = await settingsV2Repository.get();
    const label = document.createElement('label');
    label.textContent = `Chat width: ${settings.platforms.m365.chatWidthPercent}%`;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '30';
    slider.max = '100';
    slider.value = String(settings.platforms.m365.chatWidthPercent);
    slider.addEventListener('input', () => {
      label.firstChild!.textContent = `Chat width: ${slider.value}%`;
    });
    slider.addEventListener('change', async () => {
      const next = await settingsV2Repository.get();
      next.platforms.m365.chatWidthPercent = Number(slider.value);
      await settingsV2Repository.set(next);
      this.status('Appearance updated');
    });
    label.append(slider);

    const positionLabel = document.createElement('label');
    positionLabel.textContent = 'Timeline and dock position';
    const position = document.createElement('select');
    position.setAttribute('aria-label', 'Timeline and dock position');
    for (const value of ['right', 'left'] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value === 'right' ? 'Right' : 'Left';
      position.append(option);
    }
    position.value = settings.platforms.m365.dockPosition;
    position.addEventListener('change', async () => {
      const next = await settingsV2Repository.get();
      next.platforms.m365.dockPosition = position.value === 'left' ? 'left' : 'right';
      await settingsV2Repository.set(next);
      await this.applyAppearanceSettings(next);
      this.status('Appearance updated');
    });
    positionLabel.append(position);

    const inputCollapse = document.createElement('label');
    inputCollapse.className = 'check';
    const inputCollapseToggle = document.createElement('input');
    inputCollapseToggle.type = 'checkbox';
    inputCollapseToggle.checked = settings.platforms.m365.inputCollapseEnabled;
    inputCollapseToggle.addEventListener('change', async () => {
      const next = await settingsV2Repository.get();
      next.platforms.m365.inputCollapseEnabled = inputCollapseToggle.checked;
      await settingsV2Repository.set(next);
      await this.applyAppearanceSettings(next);
      this.status('Appearance updated');
    });
    inputCollapse.append(inputCollapseToggle, document.createTextNode('Collapse M365 input area'));

    const themeLabel = document.createElement('label');
    themeLabel.textContent = 'Theme';
    const theme = document.createElement('select');
    theme.setAttribute('aria-label', 'Theme');
    for (const value of ['system', 'light', 'dark'] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value[0].toUpperCase() + value.slice(1);
      theme.append(option);
    }
    theme.value = settings.theme;
    theme.addEventListener('change', async () => {
      const next = await settingsV2Repository.get();
      next.theme = theme.value === 'light' || theme.value === 'dark' ? theme.value : 'system';
      await settingsV2Repository.set(next);
      await this.applyAppearanceSettings(next);
      this.status('Appearance updated');
    });
    themeLabel.append(theme);
    main.append(label, positionLabel, inputCollapse, themeLabel);
  }

  private async applyAppearanceSettings(settingsInput?: SettingsV2): Promise<void> {
    const settings = settingsInput ?? (await settingsV2Repository.get());
    this.host.dataset.position = settings.platforms.m365.dockPosition;
    this.host.dataset.theme = settings.theme;
    document.documentElement.classList.toggle(
      INPUT_COLLAPSE_CLASS,
      settings.platforms.m365.inputCollapseEnabled,
    );
    let style = document.getElementById(INPUT_COLLAPSE_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = INPUT_COLLAPSE_STYLE_ID;
      style.textContent = `
        html.${INPUT_COLLAPSE_CLASS} [role="textbox"][contenteditable="true"] {
          max-height: 0 !important;
          min-height: 0 !important;
          opacity: 0 !important;
          overflow: hidden !important;
          pointer-events: none !important;
        }
      `;
      document.documentElement.append(style);
    }
  }

  private input(placeholder: string, value = ''): HTMLInputElement {
    const input = document.createElement('input');
    input.placeholder = placeholder;
    input.value = value;
    return input;
  }

  private button(label: string, action?: () => void | Promise<unknown>): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (action) button.addEventListener('click', () => void action());
    return button;
  }

  private empty(label: string): HTMLElement {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = label;
    return empty;
  }

  private async run<T>(operation: () => Promise<T>, success: string): Promise<T | null> {
    try {
      const value = await operation();
      this.status(success);
      return value;
    } catch (error) {
      this.status(error instanceof Error ? error.message : 'Operation failed');
      return null;
    }
  }

  private status(message: string): void {
    const status = this.shadow.querySelector<HTMLElement>('.status');
    if (status) status.textContent = message;
  }
}

let controller: VoyagerDockController | null = null;

export async function startVoyagerDock(): Promise<void> {
  if (controller || document.getElementById(HOST_ID)) return;
  controller = new VoyagerDockController();
  await controller.start();
}

export function stopVoyagerDock(): void {
  controller?.dispose();
  controller = null;
  document.getElementById(HOST_ID)?.remove();
}

const DOCK_CSS = `
  :host { color-scheme: light dark; font: 13px/1.4 "Segoe UI", system-ui, sans-serif; }
  button, input, textarea, select { font: inherit; }
  button { border: 1px solid #c7c7c7; border-radius: 4px; background: #fff; color: #242424; padding: 6px 10px; cursor: pointer; }
  button:hover { background: #f5f5f5; }
  button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid #0f6cbd; outline-offset: 2px; }
  .launcher { position: fixed; right: 18px; bottom: 108px; z-index: 2147483646; border-color: #0f6cbd; background: #0f6cbd; color: #fff; box-shadow: 0 4px 14px rgba(0,0,0,.18); }
  .panel { position: fixed; right: 18px; bottom: 150px; z-index: 2147483647; width: min(420px, calc(100vw - 36px)); height: min(620px, calc(100vh - 180px)); overflow: hidden; border: 1px solid #d1d1d1; border-radius: 8px; background: #fff; color: #242424; box-shadow: 0 12px 36px rgba(0,0,0,.22); }
  .panel[hidden] { display: none; }
  :host([data-position="left"]) .launcher { right: auto; left: 18px; }
  :host([data-position="left"]) .panel { right: auto; left: 18px; }
  header { height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; border-bottom: 1px solid #e5e5e5; }
  nav { display: flex; gap: 2px; overflow-x: auto; padding: 8px; border-bottom: 1px solid #e5e5e5; }
  nav button { border-color: transparent; background: transparent; white-space: nowrap; }
  nav button[aria-current] { border-bottom-color: #0f6cbd; color: #0f6cbd; }
  main { height: calc(100% - 132px); overflow: auto; padding: 12px; box-sizing: border-box; }
  input, textarea, select { box-sizing: border-box; width: 100%; border: 1px solid #b3b3b3; border-radius: 4px; background: #fff; color: #242424; padding: 7px 9px; }
  .filters, .prompt-form, .folder-form { display: grid; gap: 8px; margin-bottom: 10px; }
  .filters { grid-template-columns: 1fr auto auto; align-items: center; }
  .folder-form { grid-template-columns: 1fr auto; }
  .child-form { margin: 0 6px 8px 22px; }
  .file-button { display: inline-flex; align-items: center; border: 1px solid #c7c7c7; border-radius: 4px; padding: 6px 10px; cursor: pointer; }
  .file-button input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .current-conversation { margin: 10px 0; border: 1px dashed #0f6cbd; border-radius: 6px; padding: 9px; cursor: grab; }
  .check { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
  .check input, .message-heading input { width: auto; }
  .message-list, .folder-list, .prompt-list { display: grid; gap: 8px; }
  .message-item, .prompt-list article { border: 1px solid #e5e5e5; border-radius: 6px; padding: 9px; }
  .message-heading, .folder, .actions { display: flex; align-items: center; gap: 6px; }
  .message-heading .jump, .folder span { flex: 1; text-align: left; }
  .message-item p, .prompt-list p { margin: 7px 0; color: #616161; white-space: pre-wrap; }
  .actions { flex-wrap: wrap; }
  .folder { padding: 6px; border-bottom: 1px solid #ededed; }
  .folder-entry.child { margin-left: 22px; }
  .folder-entry.active { border-left: 3px solid #0f6cbd; }
  .danger { color: #a4262c; }
  main > label { display: grid; gap: 6px; margin-bottom: 14px; }
  main > label.check { display: flex; }
  .status { min-height: 20px; padding: 6px 12px; border-top: 1px solid #e5e5e5; color: #424242; }
  .empty { color: #707070; text-align: center; padding: 24px 8px; }
  @media (prefers-color-scheme: dark) {
    button, input, textarea, select, .panel { background: #292929; color: #fff; border-color: #666; }
    button:hover { background: #353535; }
    .panel, header, nav, .status, .message-item, .prompt-list article, .folder { border-color: #484848; }
    .message-item p, .prompt-list p { color: #c7c7c7; }
  }
  :host([data-theme="light"]) button,
  :host([data-theme="light"]) input,
  :host([data-theme="light"]) textarea,
  :host([data-theme="light"]) select,
  :host([data-theme="light"]) .panel { background: #fff; color: #242424; border-color: #c7c7c7; }
  :host([data-theme="dark"]) button,
  :host([data-theme="dark"]) input,
  :host([data-theme="dark"]) textarea,
  :host([data-theme="dark"]) select,
  :host([data-theme="dark"]) .panel { background: #292929; color: #fff; border-color: #666; }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; } }
  :host-context([dir="rtl"]) .launcher, :host-context([dir="rtl"]) .panel { right: auto; left: 18px; }
`;
