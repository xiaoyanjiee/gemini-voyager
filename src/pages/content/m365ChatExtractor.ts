/**
 * M365 Copilot Chat Extractor -- MVP 最小提取器
 *
 * 用途：从当前 M365 Copilot 页面提取对话消息，输出结构化数组。
 *       这是聊天导出功能的第一步验证——确认能否稳定读取消息内容。
 *
 * 这个文件是临时适配用途，正式功能完成后应替换或删除。
 */

const TAG = '[M365 ChatExtractor]';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 文本内容项 */
interface TextContent {
  kind: 'text';
  text: string;
}

/** 图片内容项 */
interface ImageContent {
  kind: 'image';
  /** src 属性（可能是相对路径、blob URL 或 data URL） */
  src: string;
  /** 浏览器实际加载的 URL（经过 srcset 解析后） */
  currentSrc: string;
  alt: string;
  title: string;
  width: number;
  height: number;
  /** 图片原始尺寸（CSS 缩放前） */
  naturalWidth: number;
  naturalHeight: number;
  /** loading 属性（eager / lazy） */
  loading: string;
  visible: boolean;
}

/** 消息中的一段内容（文本或图片） */
type ContentItem = TextContent | ImageContent;

/** 单条消息的提取结果 */
interface ChatMessage {
  /** 消息类型：user = 用户发的，assistant = Copilot 回复的 */
  type: 'user' | 'assistant';
  /** 便捷字段：消息的纯文本内容（方便快速查看） */
  text: string;
  /** 结构化内容数组：文本 + 图片 */
  content: ContentItem[];
  /** 消息中包含的图片数量 */
  imageCount: number;
  /** 消息在对话中的顺序（从 0 开始） */
  index: number;
  /** 这条消息当前是否在屏幕上可见 */
  visible: boolean;
  /** 消息 DOM 节点的 className（用于调试） */
  className: string;
  /** 消息 DOM 节点的 role 属性（用于调试） */
  role: string;
}

/** 提取结果汇总 */
interface ExtractResult {
  /** 提取时间 */
  timestamp: string;
  /** 页面 URL */
  url: string;
  /** 总消息数 */
  totalMessages: number;
  /** 用户消息数 */
  userMessages: number;
  /** Copilot 消息数 */
  assistantMessages: number;
  /** 所有消息中的图片总数 */
  totalImages: number;
  /** 消息列表 */
  messages: ChatMessage[];
}

// ---------------------------------------------------------------------------
// DOM selectors -- 基于诊断阶段侦察到的真实线索
// ---------------------------------------------------------------------------

/**
 * M365 Copilot 用户消息的 CSS 类名片段。
 * 诊断阶段发现用户消息节点的 className 包含 "fai-UserMessage"。
 */
const USER_MESSAGE_CLASS = 'fai-UserMessage';

/**
 * M365 Copilot 回复消息的 CSS 类名片段。
 * 诊断阶段发现 Copilot 回复节点的 className 包含 "fai-CopilotMessage"。
 */
const COPILOT_MESSAGE_CLASS = 'fai-CopilotMessage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 判断元素是否在屏幕上可见 */
function isVisible(el: Element): boolean {
  const htmlEl = el as HTMLElement;
  if (!htmlEl.offsetParent && htmlEl.offsetWidth === 0 && htmlEl.offsetHeight === 0) {
    return false;
  }
  const style = window.getComputedStyle(htmlEl);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

/**
 * 从一个消息容器中提取纯文本。
 * 跳过按钮、工具栏等非内容区域，尽量只拿正文。
 */
function extractMessageText(el: Element): string {
  // 尝试找到消息的实际内容区域
  // 如果消息节点内部有明确的内容容器，优先取它
  // 否则取整个节点的 textContent，并做基本清理
  const text = (el.textContent || '').trim();

  // 去掉连续多个空行，保留单个换行
  return text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ');
}

/**
 * 从消息节点中提取所有图片信息。
 * 跳过小于 20px 的追踪像素和 UI 图标，跳过按钮/工具栏内的图标。
 */
function extractImages(el: Element): ImageContent[] {
  const imgs = el.querySelectorAll('img');
  const results: ImageContent[] = [];
  imgs.forEach((img) => {
    // 跳过追踪像素和小图标（宽高都小于 20px 的）
    if (img.naturalWidth > 0 && img.naturalWidth < 20 && img.naturalHeight < 20) return;
    // 跳过 UI 控件内的图标（按钮、工具栏等）
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
      visible: isVisible(img),
    });
  });
  return results;
}

/**
 * 从消息节点中提取结构化内容（文本 + 图片）。
 * 返回便捷文本字段和结构化 content 数组。
 */
function extractContent(el: Element): { text: string; content: ContentItem[]; imageCount: number } {
  const text = extractMessageText(el);
  const images = extractImages(el);

  const content: ContentItem[] = [];
  if (text) {
    content.push({ kind: 'text', text });
  }
  content.push(...images);

  return { text, content, imageCount: images.length };
}

// ---------------------------------------------------------------------------
// Core extraction
// ---------------------------------------------------------------------------

/**
 * 从当前页面提取所有对话消息。
 *
 * 工作原理：
 * 1. 用 CSS 类名 fai-UserMessage 和 fai-CopilotMessage 找到所有消息节点
 * 2. 按它们在 DOM 中的实际出现顺序排列（这就是对话顺序）
 * 3. 提取每个节点的文本内容和元数据
 */
function extractMessages(): ExtractResult {
  // 分别查找用户消息和 Copilot 消息
  const userNodes = document.querySelectorAll(`[class*="${USER_MESSAGE_CLASS}"]`);
  const copilotNodes = document.querySelectorAll(`[class*="${COPILOT_MESSAGE_CLASS}"]`);

  console.log(`${TAG} Found ${userNodes.length} user message nodes, ${copilotNodes.length} copilot message nodes`);

  // 如果基于 class 名没找到，尝试用 role="article" 作为 fallback
  if (userNodes.length === 0 && copilotNodes.length === 0) {
    console.warn(`${TAG} No messages found by class name. Trying role="article" fallback...`);
    const articleNodes = document.querySelectorAll('[role="article"]');
    if (articleNodes.length > 0) {
      console.log(`${TAG} Found ${articleNodes.length} article nodes as fallback`);
      // 用 article 节点，但无法区分 user/assistant，标记为 unknown 后手动查看
      const messages: ChatMessage[] = [];
      articleNodes.forEach((node, i) => {
        const className = typeof node.className === 'string' ? node.className : '';
        const { text, content, imageCount } = extractContent(node);
        messages.push({
          type: className.includes('User') ? 'user' : 'assistant',
          text,
          content,
          imageCount,
          index: i,
          visible: isVisible(node),
          className: className.trim().split(/\s+/).slice(0, 5).join(' '),
          role: node.getAttribute('role') || '',
        });
      });
      const result: ExtractResult = {
        timestamp: new Date().toISOString(),
        url: location.href,
        totalMessages: messages.length,
        userMessages: messages.filter((m) => m.type === 'user').length,
        assistantMessages: messages.filter((m) => m.type === 'assistant').length,
        totalImages: messages.reduce((sum, m) => sum + m.imageCount, 0),
        messages,
      };
      console.log(`${TAG} Extraction complete (fallback mode):`, result);
      return result;
    }
  }

  // 把所有消息节点放到一个统一的数组里，附带类型标记
  const allTagged: Array<{ node: Element; type: 'user' | 'assistant' }> = [];

  userNodes.forEach((node) => {
    allTagged.push({ node, type: 'user' });
  });
  copilotNodes.forEach((node) => {
    allTagged.push({ node, type: 'assistant' });
  });

  // 按 DOM 顺序排序
  // compareDocumentPosition 是浏览器内置方法，能比较两个节点谁在前谁在后
  allTagged.sort((a, b) => {
    const position = a.node.compareDocumentPosition(b.node);
    // DOCUMENT_POSITION_FOLLOWING = 4，表示 b 在 a 后面，所以 a 排前面
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  // 构建消息数组
  const messages: ChatMessage[] = allTagged.map((item, i) => {
    const className = typeof item.node.className === 'string' ? item.node.className : '';
    const { text, content, imageCount } = extractContent(item.node);
    return {
      type: item.type,
      text,
      content,
      imageCount,
      index: i,
      visible: isVisible(item.node),
      className: className.trim().split(/\s+/).slice(0, 5).join(' '),
      role: item.node.getAttribute('role') || '',
    };
  });

  const totalImages = messages.reduce((sum, m) => sum + m.imageCount, 0);

  const result: ExtractResult = {
    timestamp: new Date().toISOString(),
    url: location.href,
    totalMessages: messages.length,
    userMessages: messages.filter((m) => m.type === 'user').length,
    assistantMessages: messages.filter((m) => m.type === 'assistant').length,
    totalImages,
    messages,
  };

  // Console output
  console.log(`${TAG} Extraction complete:`);
  console.log(`${TAG}   Total: ${result.totalMessages} messages (${result.userMessages} user, ${result.assistantMessages} assistant, ${totalImages} images)`);
  console.table(
    messages.map((m) => ({
      '#': m.index,
      type: m.type,
      imgs: m.imageCount,
      visible: m.visible,
      text: m.text.slice(0, 80) + (m.text.length > 80 ? '...' : ''),
    })),
  );
  console.log(`${TAG} Full result (also saved to window.__gvLastExtractResult):`, result);

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 启动 M365 聊天提取器。
 * 把 __gvExtract / __gvLastExtractResult 挂到 window 上供手动调用。
 */
export function startM365ChatExtractor(): void {
  console.log(`${TAG} Chat extractor loaded. Run window.__gvExtract() to extract current conversation.`);

  (window as unknown as Record<string, unknown>).__gvExtract = () => {
    const result = extractMessages();
    (window as unknown as Record<string, unknown>).__gvLastExtractResult = result;
    return result;
  };

  (window as unknown as Record<string, unknown>).__gvLastExtractResult = null;
}
