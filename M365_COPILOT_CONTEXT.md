# M365 Copilot 迁移架构基线

最后更新：2026-04-30
状态：M365 adapter 活跃基线，JSON / Markdown export MVP 与最小导出 UI 已接入，M365 chatWidth / timeline MVP 已接入并支持 M365-only popup 设置，rich content extraction 已补强
目标站点：`https://m365.cloud.microsoft/*`

这是后续 Codex 会话的交接文档。修改 M365 专用代码前，必须先阅读本文件。
桌面上的历史 `PLAN.md` / `PLAN2.md` 以及 M365 export adapter 计划已吸收到本文档；新会话不需要再导入这三份 plan。

## 当前已完成功能

- 扩展已通过 `manifest.json` 注入 `m365.cloud.microsoft`。
- `src/pages/content/index.tsx` 已把 M365 与 Gemini 功能隔离：当 `location.hostname === 'm365.cloud.microsoft'` 时，只启动手动 diagnostics、M365 chat extractor、JSON / Markdown export UI、chatWidth 和 timeline；不会启动 Gemini 功能。
- 手动诊断入口：`window.__gvDiagRun()`、`window.__gvDiagClear()`、`window.__gvLastDiagResult`；默认不会自动扫描、标记页面或保存 DOM 摘要。
- 手动提取入口：`window.__gvExtract()` 返回兼容旧调试结果；`window.__gvExtractCanonical()` 返回 canonical model。
- 真实 Edge/CDP 验证确认：content script API 位于名为 `Voyager` 的 isolated world。
- 2026-04-26 的真实 M365 DOM 证据显示：`20` 个 raw user nodes、`40` 个 raw assistant nodes、`10` 个 article nodes、`10` 条 logical messages。
- 自动化测试已覆盖：嵌套节点不重复、空 user 过滤、assistant 快照去重、多段 assistant 顺序、正文容器优先、chrome/feedback 清理、兼容 facade、image-only message、小 icon 过滤、fallback article、canonical id 稳定性。
- 手动运行 Diagnostics 时，标框优先标记真实 M365 message article，避免 breadcrumb/list 抢占 `msg[]` 标记名额。
- 2026-04-28 已在 Windows 本地开发环境验证：`npm.cmd` 测试/构建可用，Edge 加载 `L:\project\dist_chrome` 后，`Voyager` isolated world 中存在 `window.__gvDiagRun()` / `window.__gvExtract()` / `window.__gvExtractCanonical()`。
- `M365ExportService` 已提供只读 export adapter：从 `CanonicalConversation` 生成现有 `ChatTurn[]` 和 `ConversationMetadata`，支持 plain text、安全图片 Markdown、M365 JSON export MVP 和 M365 Markdown export MVP；M365 页面已接入 JSON / Markdown 最小导出 UI。
- M365 assistant 正文提取会把常见 HTML 结构保留为 Markdown 文本，包括段落空行、`strong` / `b` 粗体、`em` / `i` 斜体、`ul` / `ol` 列表、基础链接和 fenced code block；仍不重新扫描 DOM，不复用 Gemini selectors。
- M365 assistant table 提取已补强：semantic `table` / `tr` / `th` / `td` 会转成 Markdown table，并转义单元格内的 `|`，继续沿用 canonical extraction 路径。
- M365 Markdown export 标题固定使用 `M365 Copilot`，不再读取 M365 页面 `document.title`；M365 页面标题经常是首条 prompt，直接用作 Markdown H1 会让预览标题变成用户输入。
- M365 code block 提取已补强：`pre` 和多行 `code` 会输出 fenced code block；M365 偶发的语言标签 + 代码 + 残缺反引号片段会归一为标准 fenced block。
- 手动 JSON / Markdown 验证入口：`window.__gvExportM365Json()`、`window.__gvExportM365Markdown()`；这些入口仅用于本地 M365 debug/dev 真机测试，会下载当前页面导出结果并保存到对应的 `window.__gvLastM365*Export`。
- M365 chatWidth MVP 已接入并支持设置：`startM365ChatWidth()` 只在 `m365.cloud.microsoft` 分支启动，注入 `#gv-m365-chat-width-style` 并给 `document.documentElement` 添加 `gv-m365-chat-width-enabled`；CSS 只针对 M365 `chatMessageContainer...`、message article、`fai-UserMessage` / `fai-CopilotMessage` 容器，不读取消息正文、不复用 Gemini selectors、不修改 Gemini chatWidth 行为。popup 在 M365 tab 下写入 `gvM365ChatWidthEnabled` / `gvM365ChatWidthPercent`。
- M365 timeline MVP 已接入并支持设置：`startM365Timeline()` 只在 `m365.cloud.microsoft` 分支启动，基于 `extractM365CanonicalConversation()` 和 `M365TimelineService.buildIndex()` 生成 user-message markers；UI 使用 `gv-m365-timeline-*` 前缀，不复用 Gemini timeline selectors、Gemini storage、星标、preview panel 或 keyboard shortcuts；timeline 会按 conversation URL 缓存已见 user markers，避免 M365 虚拟列表卸载不可见消息时节点缩水或标题漂移。popup 在 M365 tab 下写入 `gvM365TimelineEnabled` / `gvM365TimelineScrollMode`，默认开启。

## 已吸收的计划归档

本节是历史计划的压缩事实来源，避免后续会话重新导入桌面 plan。

Plan 1：M365 canonical conversation baseline

- 目标是建立 M365 原生消息模型，不复制 Gemini selectors，也不让 export / timeline / chatWidth 各自扫描 DOM。
- `m365ChatExtractor.ts` 保留 `startM365ChatExtractor()` / `extractM365Messages()` / `window.__gvExtract()` 兼容调试入口。
- 以 `M365ConversationExtractor` 负责 raw DOM candidates，以 `CanonicalConversationBuilder` 负责排序、过滤、去重、fingerprint、稳定 id 和统计。
- `CanonicalConversation` / `CanonicalMessage` 是 export、timeline、layout 的唯一上游索引。
- 本阶段不启动 M365 export / timeline / chatWidth UI，不修改 Gemini 行为。

Plan 2：canonical baseline 收口与自动测试

- 目标是修复验证与提交阻塞，而不是开始 M365 UI 接入。
- Windows 当前主路径是 `L:\project`；验证优先使用 `npm.cmd`。WSL/Bun 命令只作为历史参考。
- 如果沙箱内 Vite/Vitest 遇到 `esbuild spawn EPERM`，在提升后的真实 Windows 环境重跑同一条 `npm.cmd` 命令。
- `AGENTS.md` 已从历史 Windows symlink/reparse point 问题收口为可正常 hash/diff 的 repo 文件。
- M365 diagnostics 仍只是临时诊断模块，不进入业务数据流；生产入口只注册手动 console helpers，不自动运行。

Plan 3：M365 export adapter baseline

- 目标是增加从 `CanonicalConversation` 到现有 export 输入的只读 adapter，不接 M365 export UI。
- `M365ExportService.buildTurns(conversation)` 生成现有 `ChatTurn[]`；`buildExportInput(conversation, title?)` 生成 `{ turns, metadata }`。
- `M365ExportService.buildJsonExport(conversation, title?)` 生成纯 JSON-safe payload；`serializeJsonExport(conversation, title?)` 生成可被 `JSON.parse` 解析的 pretty JSON 字符串。
- user message 开启新 turn；后续 assistant 归入当前 turn；连续 assistant 用空行合并；assistant-only 和 user-only turn 都保留。
- `starred` 固定为 `false`，`omitEmptySections` 固定为 `true`。
- 不向现有 export service 传入 M365 `userElement` / `assistantElement`，避免 Gemini 专用 `DOMContentExtractor` 误读 M365 DOM。
- M365 JSON payload 顶层包含 `platform: "m365-copilot"`、`title`、`url`、`exportedAt`、`count`、`turns`；每个 turn 只包含 `user`、`assistant`、`starred`、`omitEmptySections`，不包含 DOM elements。
- canonical 图片转换为安全 Markdown 图片行；只允许 `http:`、`https:`、`blob:` 和不超过 `1_048_576` 字符的 `data:image/png|jpeg|webp|gif;base64,...` 来源，其余丢弃。

Plan 4：M365 JSON export MVP

- 目标是在 `M365ExportService.buildExportInput(conversation, title?)` 之上实现最小可用 JSON 导出底层能力。
- 范围只包含 JSON：暂不做 Markdown、PDF、Image export、完整导出 UI、timeline、chatWidth，也不修改 Gemini 现有导出逻辑。
- 新增 `buildJsonExport(conversation, title?)` 和 `serializeJsonExport(conversation, title?)`，生成稳定、可 `JSON.parse` 的纯数据 JSON。
- JSON 顶层必须包含 `platform: "m365-copilot"`、`title`、`url`、`exportedAt`、`count`、`turns`；turn 只保留 `user`、`assistant`、`starred`、`omitEmptySections`。
- 不把 `Element`、`HTMLElement`、`Node`、`sourceElement`、`contentElement`、`userElement`、`assistantElement` 写入 JSON。
- 图片先保持 adapter 产出的安全 Markdown image line，不额外下载图片。
- 允许保留 `window.__gvExportM365Json()` 作为 M365 debug/dev only 本地真机验证入口；它不是最终 UI。
- 测试必须覆盖 JSON 可解析、metadata、user/assistant 内容、assistant-only、user-only、image-only、DOM object 不外泄，并确认 Gemini export 不受影响。
- 文档必须记录 JSON MVP 已具备底层导出能力，但正式 UI 仍待接入。

Plan 5：M365 Markdown export MVP

- 目标是在 `M365ExportService.buildExportInput(conversation, title?)` 之上实现最小可用 Markdown 导出底层能力。
- 范围只包含 Markdown serializer 和 debug/dev only 本地验证入口；不做正式 M365 export UI、PDF、Image export、timeline 或 chatWidth。
- `buildMarkdownExport(conversation, title?)` / `serializeMarkdownExport(conversation, title?)` 从 `CanonicalConversation` 生成可读 Markdown 字符串，包含 title、platform、url、exportedAt、count 和按顺序输出的 turns。
- Markdown turn 使用 `## Turn N`、`### User`、`### Assistant`，assistant-only 和 user-only turn 都能正常输出。
- Markdown 继续复用 `buildExportInput()` / `buildTurns()`，保留当前 adapter 产出的安全 Markdown 图片行，不重新扫描 M365 DOM，不写入 DOM object，不触碰 Gemini export。

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
  提供 `M365ExportService`、`M365TimelineService`、`M365LayoutEnhancer` 的服务边界；这些服务消费 `CanonicalConversation`，不得重新扫描 DOM。
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

`m365Diagnostics.ts` 只用于人工排查，不参与业务数据流。生产入口只注册手动 helpers；除非显式调用 `startM365Diagnostics({ autoRun: true })`，否则不会自动扫描 DOM、注入标框或记录页面摘要。

- `msg[]` 优先标记带有 `fai-UserMessage` / `fai-CopilotMessage` 的最近 `role="article"` 节点。
- 只有找不到 M365 message class 时，才 fallback 到通用 `[role="article"]`、`[role="log"]`、`[role="feed"]`、`[class*="Message"]` 等候选。
- Breadcrumb、list、navigation 只能作为 fallback 或 nav 诊断对象，不能抢占真实对话消息的 `msg[]` 标记。
- 当前最多标记前 `12` 个 message candidates；这只是可视化辅助，不影响 `window.__gvExtractCanonical()` 的提取结果。

## 迁移路线

Conversation export 路线：

- 当前 `M365ExportService.buildTurns()` 已把 `CanonicalMessage` 转换为现有 export turns，不允许直接扫描 M365 DOM。
- 当前 `M365ExportService.buildExportInput()` 已生成 `{ turns, metadata }`，metadata 来自 canonical `url` / `timestamp`，默认标题为 `M365 Copilot`。
- 当前 `M365ExportService.buildJsonExport()` 已生成纯 JSON-safe payload：`platform: "m365-copilot"`、`title`、`url`、`exportedAt`、`count`、`turns`。每个 turn 只包含 `user`、`assistant`、`starred`、`omitEmptySections`。
- 当前 `M365ExportService.serializeJsonExport()` 已生成可被 `JSON.parse` 解析的 pretty JSON 字符串。
- 当前 `M365ExportService.buildMarkdownExport()` / `serializeMarkdownExport()` 已生成可读 Markdown 字符串：标题、`platform: M365 Copilot`、`url`、`exportedAt`、`count` 和按 turn 顺序输出的 user / assistant 内容；assistant 文本来自 canonical 内容，并会保留常见 HTML 结构对应的 Markdown 粗体、列表和段落空行。
- 当前 `window.__gvExportM365Json()` / `window.__gvExportM365Markdown()` 可在 `Voyager` isolated world 中作为 M365 debug/dev only 入口下载当前页面 JSON / Markdown，并把结果保存到 `window.__gvLastM365JsonExport` / `window.__gvLastM365MarkdownExport`；这不是最终导出 UI。
- 图片会转换为 Markdown image 语法；只允许 `http:`、`https:`、`blob:` 和不超过 `1_048_576` 字符的 `data:image/png|jpeg|webp|gif;base64,...` 来源，其余 URL 会被过滤。
- 当前已添加 M365 最小 export UI，入口只支持 JSON / Markdown；更完整的正式导出体验等待更多真实对话验证后再设计。
- 优先保留 JSON 和 Markdown；PDF/Image 等富内容处理验证后再复用现有 export services。

Timeline 路线：

- 从 `CanonicalMessage` 顺序和 `sourceElement` 构建 timeline markers。
- 如需对齐现有体验，可以先只做 user-message markers，但数据源仍必须是 canonical messages，不是 M365 selectors。
- star/timestamp 持久化要和 DOM selector 细节分离。

Wider UI 路线：

- 当前已落地 M365-only chatWidth MVP，并已接入 popup 设置：`src/pages/content/m365ChatWidth.ts` 默认开启，读取 `gvM365ChatWidthEnabled` / `gvM365ChatWidthPercent`，支持开关和宽度滑杆实时生效。
- MVP 只实现 CSS/layout 逻辑：使用 `#gv-m365-chat-width-style`、`gv-m365-chat-width-enabled` 和 M365-only selectors，按百分比放宽 `chatMessageContainer...` 及其下方 `[role="article"]` 中 `fai-UserMessage` / `fai-CopilotMessage` 消息区域。
- layout 代码不得读取消息正文，也不得重新扫描消息 DOM；本次实现不依赖 `CanonicalConversation` 或 `M365ExportService`。
- 如未来确实需要消息锚点，只使用 canonical source elements。

M365 popup settings 路线：

- `src/pages/content/m365Settings.ts` 集中定义 M365-only storage key：`gvM365ChatWidthEnabled`、`gvM365ChatWidthPercent`、`gvM365TimelineEnabled`、`gvM365TimelineScrollMode`、`gvM365TimelinePosition`。
- `src/pages/popup/Popup.tsx` 会识别当前 active tab 是否为 `m365.cloud.microsoft`；M365 tab 下显示轻量 M365 设置卡片，不混入 Gemini / AI Studio 的完整设置页。
- M365 chatWidth 和 timeline 均默认开启；timeline MVP 支持 `flow` / `jump`，其中 `flow` 使用 smooth scroll，`jump` 使用 auto scroll。
- 2026-04-30 真机 CDP 验证确认：在 `Voyager` isolated world 写入 M365 storage key 后，chatWidth 开关/宽度百分比、timeline 开关和 `flow` / `jump` scroll mode 都会实时作用到真实 M365 conversation 页面；export UI root 不受影响。
- 当前 M365 popup settings 不迁移 Gemini star/pin、preview panel、keyboard shortcuts、拖拽位置或完整 timeline manager。

## Windows 本地浏览器验证流程

当前项目已迁移到 Windows 路径 `L:\project`。M365 浏览器验证默认使用 Windows 本地 `dist_chrome`，不再使用 WSL UNC 路径。

可用流程：

1. 在 Windows PowerShell 中运行 `npm.cmd run build:chrome`。
2. 在 Edge 扩展页 `edge://extensions/` 加载或 reload `L:\project\dist_chrome`。
3. 打开或刷新 `https://m365.cloud.microsoft/chat`。
4. 默认不显示 diagnostics 标框；需要排查 DOM 时，在 `Voyager` isolated world 手动调用 `window.__gvDiagRun()`，此时标框应显示 `msg[]`、`nav[]`、`editable[]` 等标签。
5. 使用 CDP 时，选择 `name === "Voyager"` 的 isolated world，再调用 `window.__gvDiagRun()`、`window.__gvExtract()` 或 `window.__gvExtractCanonical()`。
6. 验证 M365 JSON export MVP 时，在 `Voyager` isolated world 运行 `window.__gvExportM365Json()`；预期会下载 `m365-copilot-*.json`，并把 `{ filename, json, payload }` 保存到 `window.__gvLastM365JsonExport`。
7. JSON 验收重点：`JSON.parse(result.json)` 成功；`platform === "m365-copilot"`；`count > 0`；`turns[]` 只包含 `user`、`assistant`、`starred`、`omitEmptySections`；JSON 字符串不包含 `sourceElement`、`contentElement`、`userElement`、`assistantElement`、`HTMLElement`、`Node`。
8. 验证 M365 Markdown export MVP 时，在 `Voyager` isolated world 运行 `window.__gvExportM365Markdown()`；预期会下载 `m365-copilot-*.md`，并把 `{ filename, markdown }` 保存到 `window.__gvLastM365MarkdownExport`。
9. Markdown 验收重点：包含标题、`platform: M365 Copilot`、`url`、`exportedAt`、`count`、`## Turn N`、`### User` / `### Assistant`；assistant-only、user-only 和 image-only turn 可读；Markdown 字符串不包含 `sourceElement`、`contentElement`、`userElement`、`assistantElement`、`HTMLElement`、`Node`。
10. 验证 M365 chatWidth MVP 时，确认 `document.querySelectorAll('#gv-m365-chat-width-style').length === 1`，`document.documentElement.classList.contains('gv-m365-chat-width-enabled') === true`，右上角 M365 export UI 仍可见；在真实对话页上人工确认聊天内容变宽、输入框可用、顶部栏/侧边栏/菜单未被破坏。
11. 验证 M365 popup settings 时，在 M365 tab 打开扩展 popup，预期只显示 M365 Copilot 设置；切换 chatWidth 开关/滑杆应写入 `gvM365ChatWidthEnabled` / `gvM365ChatWidthPercent` 并实时影响页面；切换 timeline 开关或 `flow` / `jump` 应写入 `gvM365TimelineEnabled` / `gvM365TimelineScrollMode` 并实时影响 marker 显示和滚动行为。

注意：重新 `build:chrome` 后必须在 `edge://extensions/` 对 unpacked extension 点一次 reload。只刷新 M365 页面可能仍使用旧 manifest 中登记的旧 hashed content script 路径，导致 `window.__gvDiagRun` / `window.__gvExtractCanonical` 不存在。

PowerShell 启动示例：

```powershell
$dist='L:\project\dist_chrome'

$profile="$env:TEMP\gemini-voyager-m365-profile"
New-Item -ItemType Directory -Force -Path $profile | Out-Null

$edge='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$args=@(
  '--remote-debugging-port=9225',
  "--user-data-dir=$profile",
  "--disable-extensions-except=$dist",
  "--load-extension=$dist",
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
- 如果只看到 default context，先到 `edge://extensions/` reload 扩展，再刷新 M365 页面。

## 测试策略

Windows 主要命令：

```powershell
npm.cmd run test -- src/pages/content/m365ChatExtractor.test.ts src/pages/content/m365FeatureServices.test.ts src/pages/content/m365ExportUi.test.ts src/pages/content/m365ChatWidth.test.ts src/pages/content/m365Timeline.test.ts src/pages/popup/__tests__/m365Settings.test.tsx
npm.cmd run typecheck
npm.cmd exec -- eslint src/pages/content/m365*.ts src/pages/content/m365*.test.ts src/pages/popup/Popup.tsx src/pages/popup/__tests__/m365Settings.test.tsx
npm.cmd exec -- prettier --check src/pages/content/m365*.ts src/pages/content/m365*.test.ts src/pages/popup/Popup.tsx src/pages/popup/__tests__/m365Settings.test.tsx M365_COPILOT_CONTEXT.md M365_CHANGELOG.md
npm.cmd run build:chrome
```

Windows 环境注意事项：

- PowerShell 可能禁止直接运行 `npm.ps1`，统一使用 `npm.cmd`。
- 首次部署依赖时使用 `npm.cmd install --package-lock=false --legacy-peer-deps`；项目当前依赖树存在既有 peer dependency 冲突，普通 `npm install` 会被 peer dependency resolution 拦住。
- 如果沙箱内运行 Vite/Vitest 时遇到 `esbuild spawn EPERM`，在提升环境下运行同一条 `npm.cmd` 命令验证真实 Windows 环境。

历史 WSL 命令仅作旧环境参考：

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
- `M365ExportService.buildTurns()` 必须只消费 canonical messages，不能向现有 export service 传入 M365 DOM elements。
- `M365ExportService.buildJsonExport()` / `serializeJsonExport()` 必须生成纯数据 JSON，不包含 `sourceElement`、`contentElement`、`userElement`、`assistantElement` 或 DOM object。
- image-only message 必须能以安全 Markdown 图片行进入 export turns；不安全图片 URL 必须被过滤。

## 已知缺口

- 真实 M365 image-message DOM 仍需要更多样本采集和验证。
- 更复杂 rich Markdown fidelity 仍需要更多真实样本；当前已覆盖段落、粗体、斜体、基础列表、基础链接、code/pre、多行 code、M365 残缺 code-fence 片段、semantic table 和 images。
- Conversation loading 可能滞后于 URL 变化；未来 UI entrypoints 需要围绕 `[role="article"]` 做 wait/retry。
- M365 chatWidth MVP 初版只打到 article 层，真实页面仍被外层 `chatMessageContainer...` 包装 div 限制宽度；已追加容器层 CSS，fresh Edge + 最新 `dist_chrome` 的 CDP smoke 确认 message container 为 `1440px`、assistant content 约 `1388px`、user content 约 `1368px`。仍需要在更多真实、已登录、有消息的 M365 conversations 上做人工视觉确认。
- M365 timeline MVP 已通过单个真实 conversation 的 CDP smoke；已修复 M365 虚拟列表卸载不可见消息时 marker 从 4 个变 3 个、标题被当前 DOM 窗口覆盖的问题。仍需要在更多 conversation 长度、滚动位置、侧边栏/菜单状态下确认右侧 marker 不冲突。
- Sidebar/conversation traversal 仍然延期。
- `gv-m365-diag-marker` 等 diagnostics markers 不能影响提取。

## 里程碑

1. 在更多真实 M365 conversations 上稳定 `CanonicalConversation`，包含 image/code/table 样本。
2. 增加从 `CanonicalConversation` 到现有 export service inputs 的只读 export adapter。
3. 继续验证 M365 timeline MVP，并且任何后续增强都必须基于 `CanonicalMessage.sourceElement`，不引入新的 Gemini selector 或 storage。
4. 继续验证并收紧 M365 chatWidth MVP，只使用 CSS 和必要的 canonical anchors。
5. 生产入口保持 diagnostics 手动 gate；未来可删除临时 diagnostics 模块。

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
- 新任务的 plan 内容、执行后的实际范围、验收标准或延期项。

更新时：

1. 修改“最后更新”日期。
2. 修改对应章节，不要零散追加无上下文 notes。
3. selector 变化必须包含准确的 class/role 证据。
4. 如果本次任务有明确 plan，必须把 plan 的目标、范围、关键接口、测试要求和延期项压缩吸收到本文件与 `M365_CHANGELOG.md`，避免后续 Codex 只看到实现结果而看不到设计意图。
5. 把本文件视为后续 Codex 会话的事实来源。

## 2026-04-28 当前进度同步

配套详细变更文档：`M365_CHANGELOG.md`。

后续 Codex 修改 M365 相关代码前，必须同时阅读本文件和 `M365_CHANGELOG.md`。本文件记录压缩事实、当前架构边界和验证命令；`M365_CHANGELOG.md` 记录更详细的计划来源、阶段变更、风险原因、验证结果和下一步建议。

当前已同步的计划来源：

- 桌面 `PLAN.md`：M365 canonical conversation baseline。
- 桌面 `PLAN2.md`：canonical baseline 收口与自动化测试。
- 桌面 `PLAN3.md`：M365 export adapter baseline。
- 2026-04-28 修复计划：diagnostics 手动 gate 与 image URL 安全收口。
- 2026-04-28 M365 JSON Export MVP plan：基于 `M365ExportService` 增加 JSON serializer 和 M365 debug/dev only 导出入口，不接正式 UI，不触碰 Gemini export。
- 2026-04-28 M365 Markdown Export MVP plan：基于 `M365ExportService` 增加 Markdown serializer 和 M365 debug/dev only 导出入口，不接正式 UI，不触碰 Gemini export。

当前项目状态：

- 分支 `m365-probe` 已包含提交 `09580fc fix(m365): gate diagnostics and tighten image URLs`。
- M365 页面启动手动 diagnostics、chat extractor、JSON / Markdown export UI、chatWidth 和 timeline，不启动 Gemini 功能。
- Diagnostics 默认不会自动扫描 DOM、注入 marker、记录 URL/DOM/text 摘要；人工排查时使用 `window.__gvDiagRun()`。
- `window.__gvExtract()` 和 `window.__gvExtractCanonical()` 仍是当前 M365 提取调试入口。
- `M365ExportService` 已提供只读 adapter，可从 `CanonicalConversation` 生成 `ChatTurn[]`、metadata、M365 JSON export payload 和 M365 Markdown export string；M365 页面已接入右上角 JSON / Markdown 最小导出 UI，并已接入 M365-only chatWidth / timeline MVP 与轻量 popup settings。
- M365 Markdown export 已在真实页面验证：assistant 内容中的 `**粗体**`、`- 列表` 和段落空行可进入 `.md` 导出文件。
- `window.__gvExportM365Json()` 和 `window.__gvExportM365Markdown()` 是 M365 debug/dev only 本地验证入口，可下载当前 canonical conversation 的 JSON / Markdown，并保存对应的 `window.__gvLastM365*Export`。
- 2026-04-28 用户已按 `Voyager` isolated world 测试流程实际导出 M365 JSON 文件，并确认文件内容看起来正常；这标记 JSON export MVP 真机手动验收通过。
- Markdown image URL 只允许 `http:`、`https:`、`blob:` 和不超过 `1_048_576` 字符的 `data:image/png|jpeg|webp|gif;base64,...`。

最近一次验证通过：

```powershell
npm.cmd run test -- src/pages/content/m365ChatExtractor.test.ts src/pages/content/m365FeatureServices.test.ts src/pages/content/m365ExportUi.test.ts src/pages/content/m365ChatWidth.test.ts src/pages/content/m365Timeline.test.ts src/pages/popup/__tests__/m365Settings.test.tsx
npm.cmd run typecheck
npm.cmd exec -- eslint src/pages/content/m365*.ts src/pages/content/m365*.test.ts src/pages/popup/Popup.tsx src/pages/popup/__tests__/m365Settings.test.tsx
npm.cmd exec -- prettier --check src/pages/content/m365*.ts src/pages/content/m365*.test.ts src/pages/popup/Popup.tsx src/pages/popup/__tests__/m365Settings.test.tsx M365_COPILOT_CONTEXT.md M365_CHANGELOG.md
npm.cmd run build:chrome
git diff --check
```

最近一次真机验证：

- 2026-04-30，Codex 启动 Edge 加载 `L:\project\dist_chrome`，打开真实 M365 conversation `https://m365.cloud.microsoft/chat/conversation/3a9c838f-bbfd-48aa-a85f-4e9570d20ac8`；在 `Voyager` isolated world 确认 `chrome.storage.sync` 可用，`window.__gvExtractCanonical` / `window.__gvExportM365Json` / `window.__gvExportM365Markdown` 均存在。
- M365 settings 真机 storage 验证通过：默认状态 chatWidth style、timeline root/style/marker 和 export UI root 均为单实例；关闭 `gvM365ChatWidthEnabled` / `gvM365TimelineEnabled` 后 chatWidth 与 timeline UI 清理，export UI root 保留；设置 `gvM365ChatWidthPercent: 88` 后 CSS 包含 `88vw`；恢复默认 `75` / `flow` 后状态正常。
- M365 timeline scroll mode 真机验证通过：`gvM365TimelineScrollMode: "jump"` 时点击 marker 调用 `scrollIntoView({ block: "start", behavior: "auto" })`，`flow` 时调用 `behavior: "smooth"`，目标元素为对应 M365 user message source element。
- 工具栏 popup 视觉仍建议手动点开扩展按钮确认；本轮程序化打开 popup 时测试 Edge/CDP 会话退出，因此只记录 storage 真实生效和 popup 单测覆盖，不记录 popup 视觉真机通过。
- 2026-04-29，Codex 启动独立 Edge 测试窗口，加载 `L:\project\dist_chrome`，并打开 `https://m365.cloud.microsoft/chat`。
- 用户在真实 M365 Copilot 页面确认右上角最小导出 UI 可见，`Export JSON` 和 `Export Markdown` 两个按钮点击后均能正常导出文件。
- 这标记 M365 最小导出 UI 的真实页面 smoke test 通过；更深入的内容校验仍可在未来针对更多真实 conversations 继续补充。
- 上一次 Markdown helper 真机验证：Edge reload `L:\project\dist_chrome` 后，在 `Voyager` isolated world 运行 `window.__gvExportM365Markdown()`；导出文件包含 title、platform、url、exportedAt、count、turn headings、`### User`、`### Assistant`、`**粗体**`、`- 列表` 和段落空行，且机器检查确认不包含 DOM 泄漏标记。
- 本次 timeline 真机验证：Codex 使用最新 `L:\project\dist_chrome` 打开真实 conversation `https://m365.cloud.microsoft/chat/conversation/3a9c838f-bbfd-48aa-a85f-4e9570d20ac8`，在 `Voyager` isolated world 确认 canonical 4 条 messages / 2 条 user messages，timeline marker 数为 2；root/style/tooltip 均为 1，hover/focus tooltip 显示 user summary，click 后 marker active，刷新后不重复注入；export UI root 与 chatWidth style 仍各为 1，diagnostics marker 为 0。
- 虚拟列表回归修复：用户反馈 M365 向上翻历史时会卸载不可见对话，导致 timeline 节点从 4 个变 3 个且标题漂移。本次已改为按 conversation URL 缓存已见 user markers，并用 canonical fingerprint/summary 生成稳定 key；当前 DOM 窗口只刷新可见 marker 的 `sourceElement`，不再替换整个时间轴。

## 2026-04-29 M365 minimal export UI

- M365 Copilot 页面现在已接入最小导出 UI：右上角独立浮层提供 `Export JSON` 和 `Export Markdown` 两个入口。
- UI 只在 `m365.cloud.microsoft` 分支启动，不启动或复用 Gemini `startExportButton()` / `ExportDialog`，不修改 Gemini export 行为。
- 导出 action 继续消费 `extractM365CanonicalConversation()` 产出的 `CanonicalConversation`，并只调用 `M365ExportService.serializeJsonExport()` / `serializeMarkdownExport()`；不会重新扫描 M365 DOM，也不会复用 Gemini selector。
- 空 conversation 或无可导出 turns 时只显示轻量状态提示，不下载空文件。
- 文件名会使用页面标题或默认 `M365 Copilot`，清理 Windows 非法文件名字符和保留名，并追加 ISO 日期时间后缀。
- 2026-04-29 真机 smoke test 已确认右上角 UI 可见，JSON / Markdown 按钮点击下载正常。
- PDF、Image export、timeline 仍未接入；chatWidth 已由后续 M365-only MVP 接入。

## 2026-04-29 M365 chatWidth MVP

- M365 Copilot 页面现在已接入轻量 chatWidth：`src/pages/content/index.tsx` 只在 `m365.cloud.microsoft` 分支启动 `startM365ChatWidth()`。
- `src/pages/content/m365ChatWidth.ts` 只注入一个 `#gv-m365-chat-width-style`，并给 HTML root 添加 `gv-m365-chat-width-enabled`；多次启动保持幂等。
- CSS 只使用 M365-only selector：`[id^="chatMessageContainer"]`、`[role="article"]`、`[class*="fai-UserMessage"]`、`[class*="fai-CopilotMessage"]`、`[class*="fai-UserMessage__message"]`、`[class*="fai-CopilotMessage__content"]`；不使用 Gemini `chat-window` / `user-query` / `model-response` / `response-container` / `geminiChatWidth`。
- 2026-04-30 已接入 M365-only popup settings：默认开启，读取 `gvM365ChatWidthEnabled` / `gvM365ChatWidthPercent`，支持开关和宽度滑杆实时生效；仍不修改 M365 消息提取、JSON/Markdown export UI 或 Gemini chatWidth。
- 2026-04-29 自动化验证通过：M365 4 个 test files、40 个 tests 全部通过；`typecheck`、M365 eslint、Prettier check、`build:chrome`、`git diff --check` 通过。`build:chrome` 在沙箱内遇到已知 `esbuild spawn EPERM`，提升到真实 Windows 环境后重跑通过。
- 2026-04-29 CDP smoke test：新 Edge profile 加载 `L:\project\dist_chrome` 打开 M365 chat 后，确认 `#gv-m365-chat-width-style` 数量为 1、HTML marker 存在、style 包含 M365 selectors 且不含 Gemini selectors、右上角 export UI root 仍存在。用户随后反馈加宽未生效；CDP 检查确认外层 `chatMessageContainer...` 仍有约 `852px` max-width，修正后用最新 `dist_chrome` 打开 fresh Edge 验证：message container 为 `1440px`，assistant article 为 `1436px`，assistant content 为 `1388px`，user content 为 `1368px`。输入框可用、顶部栏/侧边栏/菜单未破坏仍需用户在真实对话页人工确认。

## 2026-04-29 M365 rich content sample validation

- 本轮补强范围只覆盖 M365 canonical extraction / JSON / Markdown export 的富内容样本，不新增 UI、不做 timeline、PDF 或 Image export，也不修改 Gemini 行为。
- `src/pages/content/m365ConversationExtractor.ts` 已把 semantic table 转为 Markdown table；表格行只读取当前 table 直属行，单元格内 `|` 会转义，多行内容会压缩为 `<br>`。
- `src/pages/content/m365ChatExtractor.ts` 和 `src/pages/content/m365ExportUi.ts` 已改为稳定默认标题 `M365 Copilot`，避免 M365 `document.title` 把用户 prompt 作为 Markdown H1 或文件名。
- 自动化测试已覆盖 code/pre、多行 code、M365 残缺 code-fence 片段、safe/unsafe links、semantic table、table pipe escaping、image `src/currentSrc/alt/title/size` metadata，以及小 icon / toolbar image 过滤。
- 真实 M365 页面验证：Codex 发送了一条无敏感测试 prompt，请求 Copilot 返回 link、fenced code block 和 table；用户检查 `D:/Downloads/m365-copilot-2026-04-29T05-55-37-676Z.json` 与 `D:/Downloads/m365-copilot-2026-04-29T05-55-37-678Z.md` 后确认两个导出文件正确。
- 随后发现该 `.md` 在 VS Code 预览中标题变成 prompt，且 code block 残留不完整反引号；原因是导出标题取了 M365 页面标题，且 M365 code block DOM 没有稳定落到标准 `<pre>`。本轮已用稳定标题和 code-fence 归一化修复。
- 修复后真机复测：加载最新 `L:\project\dist_chrome` 后，在真实 M365 页面发送无敏感测试 prompt 并导出 `m365-copilot-2026-04-29T09-36-28-344Z.json` / `m365-copilot-2026-04-29T09-36-28-346Z.md`；机器检查确认 JSON 可 parse、`platform === "m365-copilot"`、title 为 `M365 Copilot`、Markdown 以 `# M365 Copilot` 开头且不是 prompt、包含 ```json fenced code block、无残缺反引号尾巴、包含表格与 `JSON \| Markdown` 转义单元格、包含 https link、无 DOM 字段泄漏、export UI root 为 1、chatWidth style 为 1、diagnostics marker 为 0。
- 2026-04-29 追加自主真机复测：用户授权 Codex 新建/发送测试对话后，Codex 通过 Edge CDP 在真实 `https://m365.cloud.microsoft/chat` 页面发送无敏感 rich-content prompt。首轮确认 JSON/Markdown 导出、表格、pipe escaping、https link、export UI、chatWidth 和 DOM 泄漏检查正常；随后用户指出 Codex 的 code-fence 判断误把 User prompt 中的 fenced block 算入结果，真实 Assistant 输出仍是 `JSON` 标签加普通文本代码。已修复为识别 Assistant 内容里的 M365 language-label code block 形态，不依赖 User prompt。
- 最终真机复测：重建 `L:\project\dist_chrome` 并重启专用 Edge 测试 profile 后，在 `Voyager` isolated world 只检查 `role === "assistant"` 的消息；`firstAssistantHasJsonFence === true`、`lastAssistantHasJsonFence === true`、`lastAssistantContainsUserPrompt === false`，JSON 可 parse 且 `platform === "m365-copilot"`，Markdown title 稳定为 `M365 Copilot`，table/link/code 结构存在，无残缺反引号尾巴，无 DOM 字段泄漏，export UI root 为 1，chatWidth style 为 1，diagnostics marker 为 0。
- 真实 image-message 样本仍 pending；本轮没有把 PDF/Image export 接入产品路径。

## 2026-04-29 M365 timeline MVP

- M365 Copilot 页面现在已接入轻量 timeline navigator：`src/pages/content/index.tsx` 只在 `m365.cloud.microsoft` 分支启动 `startM365Timeline()`。
- `src/pages/content/m365Timeline.ts` 只注入 `#gv-m365-timeline-root`、`#gv-m365-timeline-style` 和 `#gv-m365-timeline-tooltip`；多次启动保持幂等，`stopM365Timeline()` 会移除 UI 并断开 observer。
- Timeline markers 只来自 `extractM365CanonicalConversation()` 与 `M365TimelineService.buildIndex()`，并过滤到 `role === "user"`；点击 marker 会滚动到对应 `CanonicalMessage.sourceElement`，hover/focus 显示 canonical summary tooltip。
- 为适配 M365 虚拟列表，timeline 会合并当前可见 user markers 到会话级缓存；已经见过但暂时被 DOM 卸载的 marker 会保留为 stale marker，避免节点数量和标题跟随可视窗口漂移。
- 2026-04-30 已接入 M365-only popup settings：默认开启，读取 `gvM365TimelineEnabled` / `gvM365TimelineScrollMode`；关闭时清理 root/style/tooltip，`flow` 使用 smooth scroll，`jump` 使用 auto scroll。
- 本次不接星标、preview panel、keyboard shortcuts、Gemini timeline manager、Gemini timeline selectors 或 Gemini storage；不新增消息正文扫描路径，不修改 M365 export/chatWidth/extractor 行为。
- 右侧 timeline rail 使用独立 `gv-m365-timeline-*` class/data attributes，并避开右上角 M365 export UI；2026-04-29 真实 conversation CDP smoke 已确认 marker 可见、tooltip 正常、点击后 active、刷新后不重复注入。后续仍需在更多真实 conversations 上确认不同长度和滚动状态下的视觉位置。

后续更新规则：

- 如果 M365 selectors、canonical model、extractor output、export adapter、安全策略、真实浏览器验证流程、迁移优先级或测试命令发生变化，必须同时更新本文件和 `M365_CHANGELOG.md`。
- 如果后续任务有独立 plan 或 Codex 先产出 `<proposed_plan>`，完成任务时必须把 plan 摘要和实际偏差同步进本文件和 `M365_CHANGELOG.md`。
- 每次开发完成后，后续 Codex 必须把用户当作代码新手，用简明语言解释做了什么、为什么这么做、如何验证；然后和用户一起跑一遍真实测试流程，并根据测试结果更新本文件和 `M365_CHANGELOG.md`。
- 面向用户的输出默认使用中文；plan / proposed_plan 可以使用英文。
- 本文件写简洁事实；`M365_CHANGELOG.md` 写详细原因、影响、验证和下一步。
- 后续提交时继续注意当前工作区可能存在无关 staged 文件，必要时使用显式 pathspec 提交。
