import type {
  M365ImageContent,
  M365MessageRole,
  M365RawConversation,
  M365RawMessageCandidate,
} from './m365ConversationTypes';

const USER_MESSAGE_CLASS = 'fai-UserMessage';
const COPILOT_MESSAGE_CLASS = 'fai-CopilotMessage';
const MESSAGE_ARTICLE_SELECTOR = '[role="article"]';
const EMPTY_USER_LABEL_PATTERN = /^you\s+said\s*:?\s*/i;
const MESSAGE_CONTENT_SELECTORS: Record<M365MessageRole, string> = {
  user: `[class*="${USER_MESSAGE_CLASS}__message"]`,
  assistant: `[class*="${COPILOT_MESSAGE_CLASS}__content"]`,
};
const EXCLUDED_CONTENT_SELECTOR = [
  'button',
  '[role="button"]',
  '[role="toolbar"]',
  `[class*="${USER_MESSAGE_CLASS}__accessibleHeading"]`,
  `[class*="${USER_MESSAGE_CLASS}__actionBar"]`,
  `[class*="${COPILOT_MESSAGE_CLASS}__accessibleHeading"]`,
  `[class*="${COPILOT_MESSAGE_CLASS}__avatar"]`,
  `[class*="${COPILOT_MESSAGE_CLASS}__name"]`,
  `[class*="${COPILOT_MESSAGE_CLASS}__disclaimer"]`,
  '[class*="scc-ChainOfThought"]',
  '[class*="Feedback"]',
  '[class*="feedback"]',
].join(',');
const MIN_CONTENT_IMAGE_SIZE = 20;
const MARKDOWN_BLOCK_TAGS = new Set([
  'ARTICLE',
  'BLOCKQUOTE',
  'DIV',
  'FIGURE',
  'LI',
  'MAIN',
  'P',
  'SECTION',
  'TABLE',
]);

interface TaggedNode {
  node: Element;
  role: M365MessageRole;
}

export class M365ConversationExtractor {
  static extract(doc: Document = document): M365RawConversation {
    const { taggedNodes, rawUserNodeCount, rawAssistantNodeCount } =
      this.collectTaggedMessageNodes(doc);
    const candidates = taggedNodes.map((item, ordinal) => this.createCandidate(item, ordinal, doc));

    return {
      timestamp: new Date().toISOString(),
      url: doc.location?.href || location.href,
      rawUserNodeCount,
      rawAssistantNodeCount,
      logicalCandidateCount: taggedNodes.length,
      candidates,
    };
  }

  private static collectTaggedMessageNodes(doc: Document): {
    taggedNodes: TaggedNode[];
    rawUserNodeCount: number;
    rawAssistantNodeCount: number;
  } {
    const userNodes = doc.querySelectorAll(this.getMessageSelector('user'));
    const assistantNodes = doc.querySelectorAll(this.getMessageSelector('assistant'));
    const nodesByElement = new Map<Element, M365MessageRole>();

    userNodes.forEach((node) => this.addTaggedNode(nodesByElement, node, 'user'));
    assistantNodes.forEach((node) => this.addTaggedNode(nodesByElement, node, 'assistant'));

    if (nodesByElement.size === 0) {
      doc.querySelectorAll(MESSAGE_ARTICLE_SELECTOR).forEach((node) => {
        nodesByElement.set(node, this.inferFallbackMessageType(node));
      });
    }

    return {
      taggedNodes: Array.from(nodesByElement, ([node, role]) => ({ node, role })),
      rawUserNodeCount: userNodes.length,
      rawAssistantNodeCount: assistantNodes.length,
    };
  }

  private static addTaggedNode(
    nodesByElement: Map<Element, M365MessageRole>,
    node: Element,
    role: M365MessageRole,
  ): void {
    const normalizedNode = this.normalizeMessageNode(node, role);
    const existingRole = nodesByElement.get(normalizedNode);

    if (!existingRole || existingRole === role) {
      nodesByElement.set(normalizedNode, role);
      return;
    }

    nodesByElement.set(node, role);
  }

  private static normalizeMessageNode(node: Element, role: M365MessageRole): Element {
    const article = node.closest(MESSAGE_ARTICLE_SELECTOR);
    if (article && this.hasMessageRole(article, role)) return article;

    let current = node;
    let parent = current.parentElement;
    while (parent && this.getMessageRoleFromClass(parent) === role) {
      current = parent;
      parent = parent.parentElement;
    }
    return current;
  }

  private static createCandidate(
    item: TaggedNode,
    ordinal: number,
    doc: Document,
  ): M365RawMessageCandidate {
    const contentElement = this.resolveContentRoot(item.node, item.role);
    return {
      role: item.role,
      element: item.node,
      contentElement,
      rawText: this.getElementTextWithoutUi(contentElement),
      images: this.extractImages(contentElement, doc),
      ordinal,
      visible: this.isVisible(item.node, doc),
      className: this.truncateClassName(item.node),
      roleAttribute: item.node.getAttribute('role') || '',
    };
  }

  private static resolveContentRoot(el: Element, role: M365MessageRole): Element {
    return el.querySelector(MESSAGE_CONTENT_SELECTORS[role]) || el;
  }

  private static getElementTextWithoutUi(el: Element): string {
    const clone = el.cloneNode(true);
    if (!(clone instanceof Element)) return el.textContent || '';

    clone.querySelectorAll(EXCLUDED_CONTENT_SELECTOR).forEach((node) => node.remove());
    return this.elementToMarkdownText(clone);
  }

  private static elementToMarkdownText(el: Element): string {
    return this.normalizeMarkdownSpacing(
      this.normalizeMalformedCodeFenceFragments(this.renderChildNodes(el)),
    );
  }

  private static renderChildNodes(el: Element): string {
    return Array.from(el.childNodes)
      .map((node) => this.nodeToMarkdownText(node))
      .filter((part) => part.trim().length > 0)
      .join('\n\n');
  }

  private static nodeToMarkdownText(node: ChildNode): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }

    if (!(node instanceof Element)) return '';

    if (node.matches(EXCLUDED_CONTENT_SELECTOR)) return '';

    const tagName = node.tagName.toUpperCase();
    if (tagName === 'BR') return '\n';
    if (tagName === 'IMG' || tagName === 'SVG') return '';

    if (tagName === 'PRE') {
      const code = node.textContent?.replace(/\r\n?/g, '\n').trim();
      return code ? this.codeToMarkdownBlock(code) : '';
    }

    if (tagName === 'TABLE') {
      return this.tableToMarkdown(node);
    }

    const childText = this.renderInlineChildren(node).trim();
    if (!childText) return '';

    if (/^H[1-6]$/.test(tagName)) {
      const level = Number(tagName.slice(1));
      return `${'#'.repeat(level)} ${childText}`;
    }

    if (tagName === 'STRONG' || tagName === 'B') {
      return `**${childText}**`;
    }

    if (tagName === 'EM' || tagName === 'I') {
      return `*${childText}*`;
    }

    if (tagName === 'CODE') {
      return childText.includes('\n')
        ? this.codeToMarkdownBlock(childText)
        : `\`${childText.replace(/`/g, '\\`')}\``;
    }

    if (tagName === 'A') {
      return this.anchorToMarkdown(node, childText);
    }

    if (tagName === 'UL' || tagName === 'OL') {
      return this.listToMarkdown(node, tagName === 'OL');
    }

    if (tagName === 'LI') {
      return childText;
    }

    return MARKDOWN_BLOCK_TAGS.has(tagName) ? this.normalizeMarkdownSpacing(childText) : childText;
  }

  private static renderInlineChildren(el: Element): string {
    const tagName = el.tagName.toUpperCase();
    if (tagName === 'UL' || tagName === 'OL') {
      return this.listToMarkdown(el, tagName === 'OL');
    }

    const parts = Array.from(el.childNodes).map((node) => this.nodeToMarkdownText(node));
    const hasBlockChildren = Array.from(el.children).some((child) =>
      this.isMarkdownBlockElement(child),
    );
    return parts.join(hasBlockChildren ? '\n\n' : '');
  }

  private static listToMarkdown(list: Element, ordered: boolean): string {
    return Array.from(list.children)
      .filter((child) => child.tagName.toUpperCase() === 'LI')
      .map((child, index) => {
        const marker = ordered ? `${index + 1}.` : '-';
        const content = this.renderInlineChildren(child).trim();
        return content
          .split('\n')
          .map((line, lineIndex) => (lineIndex === 0 ? `${marker} ${line}` : `  ${line}`))
          .join('\n');
      })
      .filter((item) => item.trim().length > 0)
      .join('\n');
  }

  private static tableToMarkdown(table: Element): string {
    const rows = Array.from(table.querySelectorAll('tr'))
      .filter((row) => row.closest('table') === table)
      .map((row) => this.tableRowToMarkdownCells(row))
      .filter((row) => row.length > 0);

    if (rows.length === 0) return '';

    const columnCount = Math.max(...rows.map((row) => row.length));
    const normalizedRows = rows.map((row) => this.padTableRow(row, columnCount));
    const [header, ...body] = normalizedRows;
    const separator = Array.from({ length: columnCount }, () => '---');

    return [header, separator, ...body].map((row) => `| ${row.join(' | ')} |`).join('\n');
  }

  private static tableRowToMarkdownCells(row: Element): string[] {
    return Array.from(row.children)
      .filter((child) => {
        const tagName = child.tagName.toUpperCase();
        return tagName === 'TH' || tagName === 'TD';
      })
      .map((cell) => this.escapeMarkdownTableCell(this.renderInlineChildren(cell).trim()));
  }

  private static padTableRow(row: string[], columnCount: number): string[] {
    return [...row, ...Array.from({ length: columnCount - row.length }, () => '')];
  }

  private static escapeMarkdownTableCell(value: string): string {
    return this.normalizeMarkdownSpacing(value).replace(/\|/g, '\\|').replace(/\n+/g, '<br>');
  }

  private static codeToMarkdownBlock(code: string, language = ''): string {
    const normalizedCode = code.replace(/\r\n?/g, '\n').trim();
    const normalizedLanguage = language.trim().toLowerCase();
    const fence = normalizedCode.includes('```') ? '````' : '```';
    return normalizedLanguage
      ? `${fence}${normalizedLanguage}\n${normalizedCode}\n${fence}`
      : `${fence}\n${normalizedCode}\n${fence}`;
  }

  private static normalizeMalformedCodeFenceFragments(text: string): string {
    return text.replace(
      /(^|\n\n)(json|javascript|typescript|python|bash|shell|powershell|html|css|sql|xml|yaml|markdown|text)\n\n([\s\S]*?)\n\n`{1,2}(?=\n\n|$)/gi,
      (_match, prefix: string, language: string, code: string) =>
        `${prefix}${this.codeToMarkdownBlock(code, language)}`,
    );
  }

  private static anchorToMarkdown(anchor: Element, text: string): string {
    const href = anchor.getAttribute('href')?.trim();
    if (!href || /[\s\p{C})]/u.test(href)) return text;

    try {
      const parsed = new URL(href, anchor.ownerDocument.baseURI);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return text;
      return `[${text.replace(/[\[\]]/g, '\\$&')}](${parsed.href})`;
    } catch {
      return text;
    }
  }

  private static isMarkdownBlockElement(el: Element): boolean {
    const tagName = el.tagName.toUpperCase();
    return (
      MARKDOWN_BLOCK_TAGS.has(tagName) ||
      tagName === 'UL' ||
      tagName === 'OL' ||
      /^H[1-6]$/.test(tagName)
    );
  }

  private static normalizeMarkdownSpacing(text: string): string {
    return text
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  private static extractImages(el: Element, doc: Document): M365ImageContent[] {
    const imgs = el.querySelectorAll('img');
    const results: M365ImageContent[] = [];
    imgs.forEach((img) => {
      if (this.isLikelyUiIcon(img)) return;

      const uiParent = img.closest('button, [role="button"], [role="toolbar"]');
      if (uiParent) return;

      results.push({
        kind: 'image',
        src: img.getAttribute('src') || '',
        currentSrc: img.currentSrc || '',
        alt: img.alt || '',
        title: img.title || '',
        width: img.width,
        height: img.height,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        loading: img.loading || '',
        visible: this.isVisible(img, doc),
      });
    });
    return results;
  }

  private static isLikelyUiIcon(img: HTMLImageElement): boolean {
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (width === 0 || height === 0) return false;
    return width < MIN_CONTENT_IMAGE_SIZE && height < MIN_CONTENT_IMAGE_SIZE;
  }

  private static getMessageSelector(role: M365MessageRole): string {
    return role === 'user'
      ? `[class*="${USER_MESSAGE_CLASS}"]`
      : `[class*="${COPILOT_MESSAGE_CLASS}"]`;
  }

  private static hasMessageRole(el: Element, role: M365MessageRole): boolean {
    return (
      this.getMessageRoleFromClass(el) === role ||
      Boolean(el.querySelector(this.getMessageSelector(role)))
    );
  }

  private static getMessageRoleFromClass(el: Element): M365MessageRole | null {
    const className = this.getClassName(el);
    if (className.includes(USER_MESSAGE_CLASS)) return 'user';
    if (className.includes(COPILOT_MESSAGE_CLASS)) return 'assistant';
    return null;
  }

  private static inferFallbackMessageType(node: Element): M365MessageRole {
    const roleFromClass = this.getMessageRoleFromClass(node);
    if (roleFromClass) return roleFromClass;

    const text = this.normalizeWhitespace(node.textContent || '');
    return EMPTY_USER_LABEL_PATTERN.test(text) ? 'user' : 'assistant';
  }

  private static normalizeWhitespace(text: string): string {
    return text
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  private static getClassName(el: Element): string {
    return typeof el.className === 'string' ? el.className : '';
  }

  private static truncateClassName(el: Element): string {
    return this.getClassName(el).trim().split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
  }

  private static isVisible(el: Element, doc: Document): boolean {
    const htmlEl = el as HTMLElement;
    if (!htmlEl.offsetParent && htmlEl.offsetWidth === 0 && htmlEl.offsetHeight === 0) {
      return false;
    }
    const style = doc.defaultView?.getComputedStyle(htmlEl) || window.getComputedStyle(htmlEl);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }
}
