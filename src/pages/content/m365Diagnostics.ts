/* eslint-disable no-console */
/**
 * M365 Copilot DOM Diagnostics -- 临时诊断模块
 *
 * 用途：自动扫描 M365 Copilot 页面的 DOM 结构，把关键信息以人话形式打到 Console 里，
 *       并在页面上给候选区域加临时的彩色边框标记。
 *
 * 这个文件是纯调试用途，不含任何业务逻辑。
 * 适配完成后应整个删除。
 */

/** Maximum number of candidate items to include in the structured result */
const MAX_SUMMARY_ITEMS = 8;

const TAG = '[M365 Diagnostics]';
const M365_MESSAGE_CLASS_SELECTOR = '[class*="fai-UserMessage"], [class*="fai-CopilotMessage"]';
const MESSAGE_ARTICLE_SELECTOR = '[role="article"]';
const MAX_MESSAGE_MARKERS = 12;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

interface ElementSummary {
  tag: string;
  id: string;
  className: string;
  role: string;
  ariaLabel: string;
  dataAttrs: Record<string, string>;
  textPreview: string;
  size: { width: number; height: number };
  visible: boolean;
}

interface CandidateGroup {
  total: number;
  items: ElementSummary[];
}

interface DiagResult {
  hostname: string;
  title: string;
  url: string;
  readyState: string;
  iframeCount: number;
  shadowRootCount: number;
  inputCandidates: {
    textarea: CandidateGroup;
    textInput: CandidateGroup;
    contenteditable: CandidateGroup;
  };
  messageCandidates: CandidateGroup;
  sidebarCandidates: CandidateGroup;
}

// 视觉标记的样式，通过一个 CSS class 控制开关
const MARKER_CLASS = 'gv-m365-diag-marker';
const MARKER_STYLE_ID = 'gv-m365-diag-style';

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 给节点生成一个简短的描述字符串 */
function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const classes =
    el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
  const role = el.getAttribute('role') ? `[role="${el.getAttribute('role')}"]` : '';
  const ariaLabel = el.getAttribute('aria-label')
    ? `[aria-label="${el.getAttribute('aria-label')?.slice(0, 40)}"]`
    : '';
  return `<${tag}${id}${classes}${role}${ariaLabel}>`;
}

/** Generate a structured, human-readable summary object for a DOM element */
function summarizeElement(el: Element): ElementSummary {
  const htmlEl = el as HTMLElement;
  const dataAttrs: Record<string, string> = {};
  for (const attr of el.attributes) {
    if (
      attr.name.startsWith('data-') &&
      attr.name !== 'data-reactroot' &&
      attr.name !== 'data-gv-diag-label'
    ) {
      dataAttrs[attr.name] = attr.value.slice(0, 80);
    }
  }
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    className:
      typeof el.className === 'string'
        ? el.className.trim().split(/\s+/).slice(0, 5).join(' ')
        : '',
    role: el.getAttribute('role') || '',
    ariaLabel: el.getAttribute('aria-label')?.slice(0, 60) || '',
    dataAttrs,
    textPreview: (el.textContent || '').trim().slice(0, 80),
    size: { width: htmlEl.offsetWidth, height: htmlEl.offsetHeight },
    visible: isVisible(el),
  };
}

/** 递归检测后代中是否存在 shadow root */
function detectShadowRoots(root: Element, results: string[], depth = 0): void {
  if (depth > 10) return; // 防止过深递归
  if (root.shadowRoot) {
    results.push(
      `  ${describeElement(root)} -- 有 shadowRoot (${root.shadowRoot.children.length} 个子节点)`,
    );
    for (const child of root.shadowRoot.children) {
      if (child instanceof Element) {
        detectShadowRoots(child, results, depth + 1);
      }
    }
  }
  for (const child of root.children) {
    detectShadowRoots(child, results, depth + 1);
  }
}

/** 收集带 data-* 属性的元素摘要（去重取前 30 个） */
function collectDataAttrElements(root: Element): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node && results.length < 30) {
    if (node instanceof Element) {
      const attrs = Array.from(node.attributes)
        .filter((a) => a.name.startsWith('data-') && a.name !== 'data-reactroot')
        .map((a) => `${a.name}="${a.value.slice(0, 50)}"`)
        .join(' ');
      if (attrs) {
        const desc = `${describeElement(node)} ${attrs}`;
        if (!seen.has(desc)) {
          seen.add(desc);
          results.push(`  ${desc}`);
        }
      }
    }
    node = walker.nextNode();
  }
  return results;
}

function collectMessageCandidates(): Element[] {
  const candidates: Element[] = [];
  const seen = new Set<Element>();
  const add = (el: Element): void => {
    if (seen.has(el) || !isVisible(el)) return;
    seen.add(el);
    candidates.push(el);
  };

  document.querySelectorAll(M365_MESSAGE_CLASS_SELECTOR).forEach((el) => {
    add(el.closest(MESSAGE_ARTICLE_SELECTOR) || el);
  });

  if (candidates.length > 0) {
    return candidates;
  }

  const fallbackSelectors = [
    MESSAGE_ARTICLE_SELECTOR,
    '[role="log"]',
    '[role="feed"]',
    '[data-content]',
    '[class*="message"]',
    '[class*="Message"]',
    '[class*="conversation"]',
    '[class*="Conversation"]',
    '[class*="response"]',
    '[class*="Response"]',
    '[class*="turn"]',
    '[class*="Turn"]',
  ];

  for (const sel of fallbackSelectors) {
    try {
      document.querySelectorAll(sel).forEach(add);
    } catch {
      /* 跳过无效选择器 */
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// 视觉标记系统
// ---------------------------------------------------------------------------

interface MarkedElement {
  el: Element;
  label: string;
  color: string;
}

const markedElements: MarkedElement[] = [];

function injectMarkerStyles(): void {
  if (document.getElementById(MARKER_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = MARKER_STYLE_ID;
  style.textContent = `
    .${MARKER_CLASS} {
      outline: 3px dashed var(--gv-diag-color, red) !important;
      outline-offset: -2px;
      position: relative;
    }
    .${MARKER_CLASS}::after {
      content: attr(data-gv-diag-label);
      position: absolute;
      top: 0;
      left: 0;
      background: var(--gv-diag-color, red);
      color: #fff;
      font-size: 11px;
      font-family: monospace;
      padding: 1px 6px;
      z-index: 999999;
      pointer-events: none;
      line-height: 1.4;
    }
  `;
  document.head.appendChild(style);
}

function markElement(el: Element, label: string, color: string): void {
  el.classList.add(MARKER_CLASS);
  el.setAttribute('data-gv-diag-label', label);
  (el as HTMLElement).style.setProperty('--gv-diag-color', color);
  markedElements.push({ el, label, color });
}

function clearAllMarkers(): void {
  for (const { el } of markedElements) {
    el.classList.remove(MARKER_CLASS);
    el.removeAttribute('data-gv-diag-label');
    (el as HTMLElement).style.removeProperty('--gv-diag-color');
  }
  markedElements.length = 0;
  document.getElementById(MARKER_STYLE_ID)?.remove();
}

// ---------------------------------------------------------------------------
// 诊断主逻辑
// ---------------------------------------------------------------------------

function runDiagnostics(): DiagResult {
  const lines: string[] = [];

  // -- 基本信息 --
  lines.push('');
  lines.push('='.repeat(60));
  lines.push(`${TAG} M365 Copilot 页面 DOM 诊断报告`);
  lines.push('='.repeat(60));
  lines.push(`  hostname: ${location.hostname}`);
  lines.push(`  pathname: ${location.pathname}`);
  lines.push(`  URL: ${location.href}`);
  lines.push(`  document.title: ${document.title}`);
  lines.push(`  document.readyState: ${document.readyState}`);

  // -- iframe 检测 --
  const iframes = document.querySelectorAll('iframe');
  lines.push('');
  lines.push(`--- iframe 检测 (共 ${iframes.length} 个) ---`);
  if (iframes.length === 0) {
    lines.push('  (没有 iframe)');
  } else {
    iframes.forEach((iframe, i) => {
      const src = iframe.src || iframe.getAttribute('src') || '(无 src)';
      lines.push(`  [${i}] ${describeElement(iframe)}`);
      lines.push(`      src: ${src.slice(0, 120)}`);
      lines.push(`      大小: ${iframe.offsetWidth}x${iframe.offsetHeight}`);
    });
  }

  // -- Shadow DOM 检测 --
  lines.push('');
  lines.push('--- Shadow DOM 检测 ---');
  const shadowResults: string[] = [];
  detectShadowRoots(document.documentElement, shadowResults);
  if (shadowResults.length === 0) {
    lines.push('  (未检测到 shadow root)');
  } else {
    lines.push(`  发现 ${shadowResults.length} 个 shadow root:`);
    lines.push(...shadowResults);
  }

  // -- 输入框候选 --
  lines.push('');
  lines.push('--- 输入框候选 ---');
  const textareas = document.querySelectorAll('textarea');
  const textInputs = document.querySelectorAll('input[type="text"], input:not([type])');
  const editables = document.querySelectorAll('[contenteditable="true"]');
  lines.push(`  textarea: ${textareas.length} 个`);
  textareas.forEach((el, i) => {
    lines.push(
      `    [${i}] ${describeElement(el)} 可见=${isVisible(el)} 大小=${(el as HTMLElement).offsetWidth}x${(el as HTMLElement).offsetHeight}`,
    );
    markElement(el, `textarea[${i}]`, '#e74c3c');
  });
  lines.push(`  input[text]: ${textInputs.length} 个`);
  textInputs.forEach((el, i) => {
    if (isVisible(el)) {
      lines.push(
        `    [${i}] ${describeElement(el)} 大小=${(el as HTMLElement).offsetWidth}x${(el as HTMLElement).offsetHeight}`,
      );
    }
  });
  lines.push(`  contenteditable: ${editables.length} 个`);
  editables.forEach((el, i) => {
    lines.push(
      `    [${i}] ${describeElement(el)} 可见=${isVisible(el)} 大小=${(el as HTMLElement).offsetWidth}x${(el as HTMLElement).offsetHeight}`,
    );
    if (isVisible(el)) {
      markElement(el, `editable[${i}]`, '#e67e22');
    }
  });

  // -- 消息容器候选 --
  lines.push('');
  lines.push('--- 消息容器候选（优先 M365 message article）---');
  const msgArray = collectMessageCandidates().slice(0, 20);
  if (msgArray.length === 0) {
    lines.push('  (没有找到明显的消息容器候选)');
  } else {
    lines.push(`  找到 ${msgArray.length} 个候选 (只显示可见的前 20 个):`);
    msgArray.forEach((el, i) => {
      const children = el.children.length;
      const text = (el.textContent || '').trim().slice(0, 60);
      lines.push(`    [${i}] ${describeElement(el)} 子节点=${children} 文本="${text}..."`);
      if (i < MAX_MESSAGE_MARKERS) {
        markElement(el, `msg[${i}]`, '#3498db');
      }
    });
  }

  // -- 侧边栏 / 导航 / 列表候选 --
  lines.push('');
  lines.push('--- 侧边栏/导航/列表候选 ---');
  const navSelectors = [
    'nav',
    '[role="navigation"]',
    '[role="complementary"]',
    '[role="tree"]',
    '[role="treeitem"]',
    'aside',
    '[class*="sidebar"]',
    '[class*="Sidebar"]',
    '[class*="side-bar"]',
    '[class*="SideBar"]',
    '[class*="nav"]',
    '[class*="Nav"]',
    '[class*="panel"]',
    '[class*="Panel"]',
    '[class*="drawer"]',
    '[class*="Drawer"]',
  ];
  const navCandidates = new Set<Element>();
  for (const sel of navSelectors) {
    try {
      document.querySelectorAll(sel).forEach((el) => navCandidates.add(el));
    } catch {
      /* 跳过无效选择器 */
    }
  }
  const navArray = Array.from(navCandidates).filter(isVisible).slice(0, 15);
  if (navArray.length === 0) {
    lines.push('  (没有找到明显的侧边栏/导航候选)');
  } else {
    lines.push(`  找到 ${navArray.length} 个候选 (只显示可见的前 15 个):`);
    navArray.forEach((el, i) => {
      lines.push(
        `    [${i}] ${describeElement(el)} 大小=${(el as HTMLElement).offsetWidth}x${(el as HTMLElement).offsetHeight}`,
      );
      if (i < 3) {
        markElement(el, `nav[${i}]`, '#2ecc71');
      }
    });
  }

  // -- role / aria-label 关键节点摘要 --
  lines.push('');
  lines.push('--- role / aria-label 关键节点摘要 (前 25 个) ---');
  const roleElements = document.querySelectorAll('[role], [aria-label]');
  const roleArray = Array.from(roleElements).filter(isVisible).slice(0, 25);
  if (roleArray.length === 0) {
    lines.push('  (没有找到带 role 或 aria-label 的元素)');
  } else {
    roleArray.forEach((el, i) => {
      const role = el.getAttribute('role') || '';
      const label = el.getAttribute('aria-label') || '';
      lines.push(
        `    [${i}] ${describeElement(el)} role="${role}" aria-label="${label.slice(0, 50)}"`,
      );
    });
  }

  // -- data-* 属性节点摘要 --
  lines.push('');
  lines.push('--- data-* 属性节点摘要 (前 30 个) ---');
  const dataResults = collectDataAttrElements(document.documentElement);
  if (dataResults.length === 0) {
    lines.push('  (没有找到带 data-* 属性的元素)');
  } else {
    lines.push(...dataResults);
  }

  // -- Build structured result --
  const result: DiagResult = {
    hostname: location.hostname,
    title: document.title,
    url: location.href,
    readyState: document.readyState,
    iframeCount: iframes.length,
    shadowRootCount: shadowResults.length,
    inputCandidates: {
      textarea: {
        total: textareas.length,
        items: Array.from(textareas).slice(0, MAX_SUMMARY_ITEMS).map(summarizeElement),
      },
      textInput: {
        total: textInputs.length,
        items: Array.from(textInputs)
          .filter(isVisible)
          .slice(0, MAX_SUMMARY_ITEMS)
          .map(summarizeElement),
      },
      contenteditable: {
        total: editables.length,
        items: Array.from(editables).slice(0, MAX_SUMMARY_ITEMS).map(summarizeElement),
      },
    },
    messageCandidates: {
      total: msgArray.length,
      items: msgArray.slice(0, MAX_SUMMARY_ITEMS).map(summarizeElement),
    },
    sidebarCandidates: {
      total: navArray.length,
      items: navArray.slice(0, MAX_SUMMARY_ITEMS).map(summarizeElement),
    },
  };

  // -- Console output --
  lines.push('');
  lines.push('='.repeat(60));
  lines.push(`${TAG} 诊断完成`);
  lines.push(`${TAG} 页面上带颜色边框的区域就是候选元素：`);
  lines.push(`${TAG}   红色边框 = 输入框 (textarea)`);
  lines.push(`${TAG}   橙色边框 = 可编辑区域 (contenteditable)`);
  lines.push(`${TAG}   蓝色边框 = 消息容器候选`);
  lines.push(`${TAG}   绿色边框 = 侧边栏/导航候选`);
  lines.push(`${TAG} 要清除所有标记，在 Console 运行: window.__gvDiagClear()`);
  lines.push(`${TAG} 要重新运行诊断，在 Console 运行: window.__gvDiagRun()`);
  lines.push('='.repeat(60));

  console.log(lines.join('\n'));
  console.log(`${TAG} Structured result (also saved to window.__gvLastDiagResult):`, result);

  return result;
}

function isVisible(el: Element): boolean {
  const htmlEl = el as HTMLElement;
  if (!htmlEl.offsetParent && htmlEl.offsetWidth === 0 && htmlEl.offsetHeight === 0) {
    return false;
  }
  const style = window.getComputedStyle(htmlEl);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

/**
 * 启动 M365 诊断。
 * 会等页面加载完成后自动运行一次，并把 __gvDiagRun / __gvDiagClear 挂到 window 上供手动调用。
 */
export function startM365Diagnostics(): void {
  console.log(`${TAG} M365 诊断模块已加载，等待页面就绪...`);

  injectMarkerStyles();

  // 挂载到 window 上方便手动调用
  (window as unknown as Record<string, unknown>).__gvDiagRun = () => {
    clearAllMarkers();
    injectMarkerStyles();
    const result = runDiagnostics();
    (window as unknown as Record<string, unknown>).__gvLastDiagResult = result;
    return result;
  };
  (window as unknown as Record<string, unknown>).__gvDiagClear = () => {
    clearAllMarkers();
    (window as unknown as Record<string, unknown>).__gvLastDiagResult = null;
    console.log(`${TAG} 所有诊断标记已清除，__gvLastDiagResult 已重置`);
  };

  // M365 是 SPA，DOM 会动态加载，等几秒再跑
  const RUN_DELAY_MS = 10000;
  console.log(`${TAG} 将在 ${RUN_DELAY_MS / 1000} 秒后自动运行诊断（等待 SPA 渲染）...`);
  setTimeout(() => {
    const result = runDiagnostics();
    (window as unknown as Record<string, unknown>).__gvLastDiagResult = result;
  }, RUN_DELAY_MS);
}
