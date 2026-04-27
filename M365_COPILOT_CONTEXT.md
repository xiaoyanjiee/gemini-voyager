# M365 Copilot 迁移架构基线

最后更新：2026-04-27
状态：M365 adapter 活跃基线
目标站点：`https://m365.cloud.microsoft/*`

这是后续 Codex 会话的交接文档。修改 M365 专用代码前，必须先阅读本文件。

## 当前已完成功能

- 扩展已通过 `manifest.json` 注入 `m365.cloud.microsoft`。
- `src/pages/content/index.tsx` 已把 M365 与 Gemini 功能隔离：当 `location.hostname === 'm365.cloud.microsoft'` 时，只启动 diagnostics 和 M365 chat extractor，然后直接返回。
- 手动诊断入口：`window.__gvDiagRun()`、`window.__gvDiagClear()`、`window.__gvLastDiagResult`。
- 手动提取入口：`window.__gvExtract()` 返回兼容旧调试结果；`window.__gvExtractCanonical()` 返回 canonical model。
- 真实 Edge/CDP 验证确认：content script API 位于名为 `Voyager` 的 isolated world。
- 2026-04-26 的真实 M365 DOM 证据显示：`20` 个 raw user nodes、`40` 个 raw assistant nodes、`10` 个 article nodes、`10` 条 logical messages。
- 自动化测试已覆盖：嵌套节点不重复、空 user 过滤、assistant 快照去重、多段 assistant 顺序、正文容器优先、chrome/feedback 清理、兼容 facade、image-only message、小 icon 过滤、fallback article、canonical id 稳定性。
- Diagnostics 标框已改为优先标记真实 M365 message article，避免 breadcrumb/list 抢占 `msg[]` 标记名额。

## 迁移目标

M365 adapter 需要迁移 Gemini Voyager 的三项能力，但三者必须共享同一个 M365 原生 conversation index：

- Conversation export：JSON、Markdown、PDF、Image。
- Timeline navigation：marker/index 生成和滚动导航。
- Wider conversation layout：M365 页面宽度增强。

不要直接复制 Gemini DOM selectors。不要让 export、timeline、chatWidth 各自独立扫描 M365 DOM。

## 模块边界

`CanonicalConversation` 是 M365 DOM 探测和未来用户功能之间的强制边界。

当前代码：

- `src/pages/content/m365ConversationTypes.ts`
  定义 `CanonicalConversation`、`CanonicalMessage`、raw candidate types、message roles、content items。
- `src/pages/content/m365ConversationExtractor.ts`
  `M365ConversationExtractor` 只读取 M365 DOM，返回 raw message candidates。
- `src/pages/content/m365CanonicalConversation.ts`
  `CanonicalConversationBuilder` 只负责排序、过滤、去重、文本规范化、fingerprint、稳定 id 和统计。
- `src/pages/content/m365ChatExtractor.ts`
  调试 API 的兼容 facade，委托 `M365ConversationExtractor` 和 `CanonicalConversationBuilder` 完成实际工作。
- `src/pages/content/m365FeatureServices.ts`
  预留未来 `M365ExportService`、`M365TimelineService`、`M365LayoutEnhancer` 的服务边界；这些服务消费 `CanonicalConversation`，不得重新扫描 DOM。
- `src/pages/content/m365Diagnostics.ts`
  仅用于临时诊断，不能进入业务数据流。

未来规则：

- `ExportService` 消费 `CanonicalConversation`，再适配到现有导出格式。
- `TimelineService` 消费 `CanonicalMessage`，再构建导航 index。
- `LayoutEnhancer` 只处理 layout/CSS。如果需要消息锚点，只读取 `CanonicalMessage.sourceElement`。

## 消息提取基线

已知 M365 消息类名：

```text
fai-UserMessage
fai-CopilotMessage
```

逻辑消息根节点是 `role="article"`。M365 的 raw class matches 可能在同一个 article 内嵌套或重复，所以 extractor 会把 class match 归一到最近的逻辑 article root。

User 识别：

- 优先 `[class*="fai-UserMessage"]`。
- 将 raw matches 归一到最近的 `[role="article"]`。
- 正文根优先 `[class*="fai-UserMessage__message"]`。
- 清理开头的 `You said:`。
- 清理后为空的 user placeholder 会被丢弃。

Assistant 识别：

- 优先 `[class*="fai-CopilotMessage"]`。
- 将 raw matches 归一到最近的 `[role="article"]`。
- 正文根优先 `[class*="fai-CopilotMessage__content"]`。
- 排除 buttons、toolbars、accessible headings、avatar/name/disclaimer chrome、chain-of-thought UI、feedback UI。

图片识别：

- button、`role="button"`、`role="toolbar"` 内的图片视为 UI 图标并跳过。
- 宽高都小于 `20px` 的图片视为小 icon 或 tracking pixel 并跳过。
- 没有文字但包含有效图片的消息会保留为 image-only message。

Fallback 识别：

- 如果找不到 `fai-UserMessage` 和 `fai-CopilotMessage` class，会退回扫描 `[role="article"]`。
- fallback 下，文本以 `You said:` 开头的 article 识别为 user，其余 article 识别为 assistant。

去重与 id：

- 空 text-only message 会被丢弃，除非它包含有效图片。
- 相邻重复 logical messages 会按 fingerprint 去重。
- Fingerprint 格式是 `role + normalized lowercase text + image keys`。
- Message id 格式是 `m365:<index>:<fingerprintHash>`。
- 这些 id 对同一个已渲染页面状态的重复提取保持稳定，但不是跨会话、跨编辑的永久数据库 id。

## 诊断标框规则

`m365Diagnostics.ts` 只用于人工排查，不参与业务数据流。

- `msg[]` 优先标记带有 `fai-UserMessage` / `fai-CopilotMessage` 的最近 `role="article"` 节点。
- 只有找不到 M365 message class 时，才 fallback 到通用 `[role="article"]`、`[role="log"]`、`[role="feed"]`、`[class*="Message"]` 等候选。
- Breadcrumb、list、navigation 只能作为 fallback 或 nav 诊断对象，不能抢占真实对话消息的 `msg[]` 标记。
- 当前最多标记前 `12` 个 message candidates；这只是可视化辅助，不影响 `window.__gvExtractCanonical()` 的提取结果。

## 迁移路线

Conversation export 路线：

- 只有当 `CanonicalConversation` 在更多真实对话上稳定后，才添加 M365 export UI。
- 把 `CanonicalMessage` 转换为现有 export turns，不允许直接扫描 M365 DOM。
- 优先保留 JSON 和 Markdown；PDF/Image 等富内容处理验证后再复用现有 export services。

Timeline 路线：

- 从 `CanonicalMessage` 顺序和 `sourceElement` 构建 timeline markers。
- 如需对齐现有体验，可以先只做 user-message markers，但数据源仍必须是 canonical messages，不是 M365 selectors。
- star/timestamp 持久化要和 DOM selector 细节分离。

Wider UI 路线：

- `M365LayoutEnhancer` 只实现 CSS/layout 逻辑。
- layout 代码不得读取消息正文，也不得重新扫描消息 DOM。
- 如确实需要锚点，只使用 canonical source elements。

## 真实浏览器验证流程

Edge 不能稳定地从 WSL UNC 路径直接加载 unpacked extension：

```text
\\wsl.localhost\Ubuntu\home\xiaoyanjie\projects\gemini-voyager\dist_chrome
```

可用流程：

1. 在 WSL 中构建。
2. 把 `dist_chrome` 复制到 Windows 本地临时目录。
3. 用 `--load-extension=<windows-local-dist>` 和干净 profile 启动 Edge。
4. 使用 CDP，在 `Voyager` isolated world 中执行提取入口。

PowerShell 示例：

```powershell
$src='\\wsl.localhost\Ubuntu\home\xiaoyanjie\projects\gemini-voyager\dist_chrome'
$dst="$env:TEMP\gemini-voyager-dist-chrome"
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
Copy-Item -Recurse -Force $src $dst

$profile="$env:TEMP\gemini-voyager-m365-profile"
New-Item -ItemType Directory -Force -Path $profile | Out-Null

$edge='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$args=@(
  '--remote-debugging-port=9225',
  "--user-data-dir=$profile",
  "--disable-extensions-except=$dst",
  "--load-extension=$dst",
  '--no-first-run',
  '--no-default-browser-check',
  'https://m365.cloud.microsoft/chat'
)
Start-Process -FilePath $edge -ArgumentList $args
```

CDP 规则：

- 枚举 `Runtime.executionContextCreated`。
- 选择 `name === "Voyager"` 的 context。
- 在该 context 中调用 `window.__gvExtract()` 或 `window.__gvExtractCanonical()`。

## 测试策略

主要命令：

```bash
/home/xiaoyanjie/.bun/bin/bun run test src/pages/content/m365ChatExtractor.test.ts
/home/xiaoyanjie/.bun/bin/bun run typecheck
/home/xiaoyanjie/.bun/bin/bunx eslint src/pages/content/m365*.ts src/pages/content/m365*.test.ts
/home/xiaoyanjie/.bun/bin/bunx prettier --check src/pages/content/m365*.ts src/pages/content/m365*.test.ts
/home/xiaoyanjie/.bun/bin/bun run build:chrome
```

必要回归覆盖：

- 嵌套 M365 nodes 不会产生重复 user messages。
- 清理 `You said:` 后为空的 user placeholders 不会保留。
- 相邻重复 assistant snapshots 会被去重。
- 多段 assistant content 在 canonical order 中稳定。
- 优先读取 M365 正文容器，不把 heading、name、action bar 等 UI chrome 混入正文。
- button/toolbar/小尺寸 icon 不会被当作内容图片。
- image-only message 会被保留并计入 `totalImages`。
- fallback article 模式可以在 class 缺失时提取基本 user/assistant。
- `CanonicalConversation.totalMessages` 匹配真实 logical message count，而不是 raw class-node count。
- `extractM365Messages()` 必须继续由 canonical 输出驱动。
- 同一 DOM 状态重复提取时，canonical ids 和 fingerprints 保持稳定。

## 已知缺口

- 真实 M365 image-message DOM 仍需要更多样本采集和验证。
- Code blocks、tables、links、rich Markdown fidelity 目前只建模到 flattened text 加 images。
- Conversation loading 可能滞后于 URL 变化；未来 UI entrypoints 需要围绕 `[role="article"]` 做 wait/retry。
- Sidebar/conversation traversal 仍然延期。
- `gv-m365-diag-marker` 等 diagnostics markers 不能影响提取。

## 里程碑

1. 在更多真实 M365 conversations 上稳定 `CanonicalConversation`，包含 image/code/table 样本。
2. 增加从 `CanonicalConversation` 到现有 export service inputs 的只读 export adapter。
3. 从 `CanonicalMessage` 生成 timeline markers，不引入新的 DOM selectors。
4. 增加 M365 layout enhancer，只使用 CSS 和必要的 canonical anchors。
5. 生产发布前 gate 或移除 diagnostics。

## 更新协议

以下内容变化时，必须更新本文件：

- M365 DOM selectors。
- `CanonicalConversation` 或 `CanonicalMessage` shape。
- Extractor output shape。
- 真实浏览器测试流程。
- 真实 DOM 证据。
- 当前优先级或延期范围。
- M365 相关文件。
- 测试/构建命令。

更新时：

1. 修改“最后更新”日期。
2. 修改对应章节，不要零散追加无上下文 notes。
3. selector 变化必须包含准确的 class/role 证据。
4. 把本文件视为后续 Codex 会话的事实来源。
