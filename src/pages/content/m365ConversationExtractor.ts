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
    return clone.textContent || '';
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
