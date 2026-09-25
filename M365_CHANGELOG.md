# M365 Copilot 变更与进度文档

最后更新：2026-09-25
当前状态：Voyager V2 M365 Dock 已通过 Edge 真机回归（专用测试 profile + CDP 自动化）
配套上下文：`M365_COPILOT_CONTEXT.md`

后续 Codex 会话开始修改 M365 相关代码前，必须先阅读本文件和 `M365_COPILOT_CONTEXT.md`。任何改变 M365 selectors、canonical model、extractor 输出、export adapter、安全策略、浏览器验证流程或迁移优先级的任务，都必须同时更新这两个文档。

## 2026-09-25 长对话 Timeline 空白与导出失效修复

问题：用户反馈打开历史长对话后 Timeline 不显示任何消息，Export 点击无反应。

根因：`CanonicalConversationBuilder.createFingerprint` 把整条消息正文拼进 fingerprint（`role + 全文 + imageKeys`），而 `SnapshotMessageSchema` 限制 `fingerprint` 最长 500 字符。长对话中 assistant 回复通常超过 500 字符，`ConversationSession.merge()` 内 `parseConversationSnapshot` 抛 ZodError，被 `VoyagerDock.refresh()` 捕获后仅记 debug 日志，`this.snapshot` 保持为 `null`。后果是 Timeline 渲染空列表、Export 因 `if (!this.snapshot) return` 静默返回。短对话 fingerprint 不超 500，所以此前真机回归未暴露。

修复：

- `createFingerprint` 改为定长哈希 `role:textLength:hash(text):hash(imageKeys)`（约 32 字符），去重与会话合并只依赖相等性，语义不变。
- `snapshotAdapter` 增加同类上限保护：title 截断到 500（`document.title` 在长首条 prompt 会话上可能超长）、code block language 截断到 80、`safeUrl` 拒绝超过 4096 的 URL，防止其他字段再触发整段 snapshot 校验失败。

验证：

- 新增 `src/pages/content/m365CanonicalConversation.test.ts`：10 万字符消息走完整 `build → capture → parseConversationSnapshot` 链路不抛错，相邻相同长消息仍去重。
- M365 定向测试 9 文件 35 项通过；`typecheck`、ESLint、Prettier、`build:chrome` 均通过。
- Edge 真机（专用 profile + CDP）在用户真实长对话 `7b197609-…`（多轮物理试卷讨论，含 500+ 字符回复、表格）验证：Timeline 正常渲染，向上滚动经虚拟窗口合并累积到 14 条且序号唯一无重复；JSON 导出（`count=10`，`gemini-voyager.chat.v1`）与 Markdown 导出均生成正确文件。

已知限制（非本次回归）：长对话的导出内容是"滚动浏览过程中已渲染过的消息"的累积集合——刚打开页面未滚动时只覆盖当前虚拟窗口（本次为 10 条），滚动越多合并越全。这与 V2 虚拟窗口设计一致。

## 2026-09-25 Edge 真机回归（无代码变更）

本轮目标：在真实 Edge 环境对当前 `m365-probe` 分支做 M365 全功能回归，不改代码。

环境与方法：

- `npm.cmd run test -- src/pages/content/m365ChatWidth.test.ts src/pages/popup/__tests__/m365Settings.test.tsx src/platforms/m365`：8 个文件 33 项测试通过；`typecheck` 通过；`build:chrome` 通过（17.8s）。
- 启动 Edge 153 + 专用 profile `%TEMP%\gemini-voyager-m365-profile`，`--remote-debugging-port=9225`，`--load-extension=L:\My project\project\dist_chrome`；登录态由 Windows SSO 账户自动完成（帐户选择页自动跳过）。
- 自动化驱动：Windows 侧 Node 24 直连 CDP（`Runtime.evaluate` + `Input.dispatch*` + `Page.captureScreenshot`），M365 功能验证都在 `Voyager` isolated world 执行。

验证结果：

- 注入与 UI：`#gv-m365-voyager-dock` 单实例、`#gv-m365-chat-width-style` 单实例、html `gv-m365-chat-width-enabled`、input-collapse style 注入；Dock launcher/panel 正常开合，5 个页签齐全。
- Timeline：发送无敏感 prompt 后，不切换页签即实时出现 `1. user` / `2. assistant`；浏览器重启重开对话页后仍 2 条唯一消息，无流式片段残留、无重复编号。
- 消息操作：Star→Unstar 切换与 `aria-pressed` 正确，Copy text 成功，Quote 以 `>` 前缀插入 M365 contenteditable 编辑器。
- 导出：JSON（`gemini-voyager.chat.v1`，含 user/assistant turn）、Markdown（`# 标题`、`## Turn 1` 结构）、IMAGE（PNG 下载）均成功；勾选单条消息后导出 JSON `count=1` 正确反映选择集。PDF 走 `window.print()`：print container/`gv-pdf-printing`/`gv-pdf-print-styles` 均注入确认，原生打印对话框未自动确认属正常。
- Organize：根文件夹、子文件夹创建成功；"File chat" 归档当前会话并高亮；删除文件夹级联清理子文件夹且会话 folderId 置空；"No folders yet" 空态恢复；workspace 导出 `voyager-m365-workspace-v2.json` 结构合法。
- Prompts：新增（title/tags/text）、Insert 写入 M365 编辑器、Edit 改名、Delete tombstone 删除均生效，最终空态。
- Appearance：宽度滑杆实时写 `chatWidthPercent` 并更新 CSS 至 `88vw`；dockPosition `left`/`right` 切换移动 launcher/panel；`theme: dark` 面板转暗色；输入区折叠后 M365 editor 计算样式 `max-height: 0`。全部恢复默认（right/system/未折叠/75vw）。
- Popup：后台重载 `src/pages/popup/index.html`（保持 m365 tab 为活动 tab）后渲染 `M365ControlCenter` 中文界面，概览指标与 7 个区块均正常；真实工具栏弹窗视觉仍建议人工点开确认。
- Console 采样 12s：仅 M365 原生 preload warning、`unload` permissions policy violation 和一处 404，无 Voyager 相关异常。

观察项（非阻塞）：

- `accountScope` 在本账号页面解析为 `m365:unknown`（`resolveM365AccountScope` 的头像 hint selectors 未命中），workspace 数据归入 unknown scope；不影响功能正确性，但多账号区分未覆盖。
- 历史真机流程中的 `window.__gvDiagRun` / `__gvExtract*` / `__gvExportM365*` helpers 在 V2 已不存在（diagnostics 仅 dev 模式注册）；文档"Windows 本地浏览器验证流程"章节仍引用这些旧入口，后续如有需要应以 `Voyager` world 内的 Dock/会话能力为准。
- 测试 Edge 窗口被用户手动关闭过一次；重新用同一 profile 启动即恢复，登录态保留。

## 2026-07-12 Voyager V2 首轮真机修复

真实 Chrome `Test` 对话验证先确认了扩展注入、Dock、发送与回复、提示词插入、引用、LaTeX 公式、JSON / Markdown / PDF / Image 导出、选择导出、宽度控制与关闭恢复。随后稳定复现以下问题：

- canonical ID 含窗口相对 index 与全文 fingerprint，流式文本变化会创建新 ID；虚拟窗口变化又会让相同消息获得不同 ID。
- Dock observer 只监听宽泛根节点的 `childList`，没有覆盖流式 `characterData`，也没有在 M365 替换 feed 后重连。
- 星标只通过状态栏反馈；提示词没有编辑删除；文件夹创建使用阻塞式原生 prompt；Appearance 只有宽度滑杆。

本轮修复：

- `ConversationSession` 用 DOM anchor 延续流式消息身份，用 fingerprint 合并虚拟窗口中的同一消息，并按持久顺序输出唯一 index。
- Observer 绑定消息所在 feed/log，监听 `childList + characterData`，每秒检查根节点替换并安全重连。
- 星标按钮增加 `Star` / `Unstar` 与 `aria-pressed` 状态。
- `M365WorkspaceService` 增加提示词 tombstone 删除；Dock 增加提示词编辑、取消编辑、删除。
- 文件夹和子目录创建改为内联表单，增加删除入口，不再调用 `window.prompt()`。
- V2 设置增加 `dockPosition`；Appearance 增加左右位置、输入区折叠和 system/light/dark 主题，停止功能时清理注入样式与页面 class。

定向验证：

- `typecheck` 通过。
- 4 个定向测试文件共 18 个测试通过，覆盖流式替换、虚拟窗口去重、提示词 tombstone、文件夹表单、提示词编辑删除和布局设置。
- 完整验证通过：Prettier、ESLint（0 warnings）、TypeScript、100 个测试文件共 678 项、Chrome / Edge / Firefox build、VitePress docs build、`npm audit --omit=dev`（0 vulnerabilities）和 `git diff --check`。

第二轮 Chrome 真机结果：

- 新构建已显示内联文件夹、工作区导入/导出、提示词编辑删除和新版 Appearance。
- 刷新后的时间轴是 10 条唯一消息；发送 `Voyager 实时回归 1247` 后，不切换 Dock 页签即可实时出现第 11 条用户消息和第 12 条最终回复，最终 12 个 heading 全部唯一，没有残留流式片段。
- 星标按钮成功切换为 `Unstar` 且 `aria-pressed=true`，随后还原。
- 临时提示词完成新增、编辑、删除，最终为空。
- 临时根目录和子目录完成创建、归档、高亮、移出和删除，最终为空；自动化鼠标拖动没有生成 HTML5 `dataTransfer`，因此拖放仍需要人工鼠标确认。
- Dock 左右位置、暗色主题与 M365 输入区折叠真机生效，测试后恢复 `right/system/未折叠`。
- 工作区导出显示 `Workspace export started`；浏览器自动化禁止向文件选择器注入本地 fixture，UI 导入仍待人工点选验证。

## 文档定位

`M365_COPILOT_CONTEXT.md` 是压缩后的事实入口，供新会话快速判断当前架构和约束。

本文件是更详细的变更记录，记录计划来源、每个阶段完成了什么、为什么这么做、验证结果、仍然不能做什么，以及下一位 Codex 应该从哪里继续。

## 计划来源

本阶段吸收了桌面上的三份历史 plan、2026-04-28 的修复 plan、M365 JSON Export MVP plan，以及 M365 Markdown Export MVP plan：

- `PLAN.md`：建立 M365 原生 canonical conversation baseline，不复制 Gemini selectors，不让 export / timeline / chatWidth 各自扫描 M365 DOM。
- `PLAN2.md`：收口 canonical baseline、恢复验证环境、修复 Windows checkout/AGENTS 阻塞，并确认 diagnostics 只是临时诊断模块。
- `PLAN3.md`：建立从 `CanonicalConversation` 到现有 export 输入的只读 adapter，不接入 M365 export UI。
- 2026-04-28 修复 plan：把 M365 diagnostics 从默认自动运行改为手动入口，并收紧 `data:image` Markdown 输出安全边界。
- M365 JSON Export MVP plan：基于 `M365ExportService.buildExportInput(conversation, title?)` 增加 JSON serializer 和 M365 debug/dev only 导出入口，只做 JSON MVP，不做正式 UI，不改 Gemini export。
- M365 Markdown Export MVP plan：基于 `M365ExportService.buildExportInput(conversation, title?)` 增加 Markdown serializer 和 M365 debug/dev only 导出入口，只做底层 Markdown 生成和测试，不做正式 UI，不改 Gemini export。

这些 plan 的稳定事实已经同步进 `M365_COPILOT_CONTEXT.md`。后续不要重新导入桌面 plan 作为新的事实源；如需查细节，以本文件和上下文文档为准。后续 Codex 如果先产出或收到新的 plan，完成任务时也必须把 plan 摘要、实际落地范围、延期项和验证结果合并进这两个文档。

## 当前项目进度

当前分支：`m365-probe`

当前交接状态：

- 项目路径是 `L:\project`；后续 Codex 开始前必须先读 `M365_COPILOT_CONTEXT.md`、`M365_CHANGELOG.md`、`AGENTS.md`、`CLAUDE.md`。
- 本轮开始前本地最新提交是 `fec078b docs(m365): record handoff snapshot`。
- 本轮开始前本地 `m365-probe` 领先 `origin/m365-probe` 2 个提交；远端目前停在 `2fb4617 fix(m365): avoid timeline tooltip export overlap`。
- 当前有一个无关 staged 文件 `.agents/skills/safari-release/SKILL.md`，不能误提交；提交 M365 变更时必须继续使用显式 pathspec。
- 如果后续需要同步 GitHub，只 push `m365-probe`，不要碰 `main`。

最近关键提交：

- `fec078b docs(m365): record handoff snapshot`
- `e90f577 fix(m365): keep timeline off native scrollbar`
- `2fb4617 fix(m365): avoid timeline tooltip export overlap`
- `9edac4c feat(m365): refine export and timeline ui`
- `8aed801 docs(m365): record settings browser validation`
- `7c459b8 feat(m365): add settings controls`
- `99c3af2 feat(m365): add minimal export ui`
- `09580fc fix(m365): gate diagnostics and tighten image URLs`
- `90c892c docs(m365): absorb migration plans into context`
- `8d02fb0 feat(m365): add export adapter baseline`
- `107d02a docs(m365): record windows validation workflow`
- `2cad326 fix(m365): prioritize diagnostic message markers`

当前能力：

- `manifest.json` 已覆盖 `https://m365.cloud.microsoft/*`，content script 会进入 M365 页面。
- `src/pages/content/index.tsx` 已把 M365 与 Gemini 功能隔离：M365 页面只注册 M365 手动 diagnostics、chat extractor 和 M365-only 最小 export UI，然后 return，不启动 Gemini timeline/export/sidebar 等功能。
- `window.__gvExtract()` 保持旧调试输出兼容；`window.__gvExtractCanonical()` 返回 canonical model。
- `window.__gvDiagRun()` / `window.__gvDiagClear()` 仍可用于人工排查，但默认不会自动扫描 DOM、注入 marker、记录 URL/DOM/text 摘要。
- `CanonicalConversation` / `CanonicalMessage` 已成为 M365 extraction 和未来 export/timeline/layout 之间的强制边界。
- `M365ExportService.buildTurns()` 和 `buildExportInput()` 已能从 canonical conversation 生成现有 export service 可消费的 `ChatTurn[]` 和 metadata。
- `M365ExportService.buildJsonExport()` 和 `serializeJsonExport()` 已能生成纯数据 M365 JSON payload/string。
- `M365ExportService.buildMarkdownExport()` 和 `serializeMarkdownExport()` 已能生成包含 metadata 和 turns 的 M365 Markdown string。
- M365 assistant 正文提取会把常见 HTML 结构保留为 Markdown 文本，包括段落空行、粗体、斜体、基础列表、基础链接和 code/pre。
- M365 assistant table 提取已补强为 Markdown table，并会转义单元格内的 `|`。
- M365 Markdown export 标题固定使用 `M365 Copilot`，不再使用 M365 页面 `document.title`；M365 页面标题可能是首条 prompt。
- M365 code block 提取已补强：`pre` 和多行 `code` 输出 fenced code block，并会归一化 M365 偶发的语言标签 + 代码 + 残缺反引号片段。
- `window.__gvExportM365Json()` / `window.__gvExportM365Markdown()` 是仅用于本地验证的 M365 debug/dev 入口，会下载当前页面 JSON / Markdown 并保存对应的 `window.__gvLastM365*Export`。
- Export adapter 已接入 M365-only UI：右上角只显示一个 `Export` trigger，点击后打开 JSON / Markdown 弹窗，状态反馈使用独立 toast；不改变 Gemini export 行为。
- M365 chatWidth MVP 已接入 M365-only 启动分支：只注入隔离 CSS 和 HTML marker，不读取消息正文、不依赖 canonical/export services、不改变 Gemini chatWidth；真实页面反馈初版未生效后，已追加外层 `chatMessageContainer...` 包装 div 的宽度覆盖。
- M365 timeline MVP 已接入 M365-only 启动分支：基于 `extractM365CanonicalConversation()` 和 `M365TimelineService.buildIndex()` 生成 user-message markers，点击 marker 滚动到对应 `CanonicalMessage.sourceElement`，不复用 Gemini timeline selectors/storage/UI state；已按 conversation URL 缓存已见 markers，避免 M365 虚拟列表卸载不可见消息时节点缩水或标题漂移；本轮只优化 rail、marker、active/stale 和 tooltip 视觉。

## 阶段变更记录

### 1. M365 canonical conversation baseline

目标是建立 M365 原生消息模型，而不是复用 Gemini 的 DOM selectors。

已完成：

- 新增 M365 raw DOM extractor 和 canonical builder 分层。
- raw extractor 负责从 M365 DOM 收集 user / assistant candidates、正文容器、图片、可见性和 DOM 顺序。
- canonical builder 负责排序、空消息过滤、相邻重复去重、fingerprint、稳定 id 和统计汇总。
- `m365ChatExtractor.ts` 保留 `startM365ChatExtractor()`、`extractM365Messages()` 和 `window.__gvExtract()` 兼容入口。
- `window.__gvExtractCanonical()` 暴露 canonical 调试入口。

关键边界：

- M365 feature services 必须消费 `CanonicalConversation`，不得重新扫描 M365 DOM。
- Future export / timeline / layout 都必须从 canonical 层接入。
- Canonical ids 对同一已渲染页面状态稳定，但不是跨会话、跨编辑的永久数据库 id。

### 2. M365 diagnostics 收口

早期 diagnostics 用于真实页面 DOM 取证，会自动运行、注入 marker、打印 URL/DOM/text 摘要，并把结果存到 `window.__gvLastDiagResult`。

当前状态：

- diagnostics 仍保留为临时人工排查工具。
- 生产入口默认只注册手动 console helpers。
- `startM365Diagnostics()` 默认 `autoRun: false`。
- 只有显式调用 `startM365Diagnostics({ autoRun: true })` 才恢复延迟自动运行。
- `window.__gvDiagRun()` 才会清理旧 marker、注入 marker style、执行 DOM 扫描并保存 `__gvLastDiagResult`。

为什么这样改：

- 避免在 M365 正常页面默认修改 DOM、显示标框、打印可能含有用户内容的摘要。
- 降低 correctness、privacy、performance 和 UX 风险。
- 保留调试能力，方便未来 selector drift 或真实 DOM 取证。

### 3. Export adapter baseline

目标是让 M365 canonical conversation 能转换为现有 export service 的输入，但不打开 M365 export UI。

已完成：

- `M365ExportService.buildTurns(conversation)` 生成 `ChatTurn[]`。
- `M365ExportService.buildExportInput(conversation, title?)` 生成 `{ turns, metadata }`。
- user message 开启新 turn，后续 assistant message 归入当前 turn。
- 连续 assistant message 用空行合并。
- assistant-only 和 user-only turn 都保留。
- `starred` 固定为 `false`，`omitEmptySections` 固定为 `true`。
- 不向现有 export service 传入 M365 DOM elements，避免 Gemini 专用 DOM extractor 误读 M365 页面。

当前限制：

- 仍未添加 M365 export 按钮或 dialog。
- 当前重点是 JSON/Markdown 所需的 text + safe image markdown 输入。
- PDF/Image/rich Markdown fidelity 需要更多真实 M365 样本验证后再接入。

### 4. M365 JSON export MVP

目标是在不接入正式 UI、不调用 Gemini DOM extractor 的前提下，让 M365 canonical conversation 可以生成稳定 JSON。

Plan 内容：

- 在 `M365ExportService.buildExportInput(conversation, title?)` 之上实现 JSON MVP。
- 只做 JSON，不做 Markdown、PDF、Image export、完整导出 UI、timeline 或 chatWidth。
- 不重新扫描 M365 DOM，不复制 Gemini selectors，不修改 Gemini 现有导出逻辑。
- 新增 `buildJsonExport(conversation, title?)` 和 `serializeJsonExport(conversation, title?)`。
- JSON 顶层至少包含 `platform: "m365-copilot"`、`title`、`url`、`exportedAt`、`count`、`turns`。
- 每个 turn 只包含 `user`、`assistant`、`starred`、`omitEmptySections`。
- 不把 `Element`、`HTMLElement`、`Node`、`sourceElement`、`contentElement`、`userElement`、`assistantElement` 写入 JSON。
- 图片先保持当前 adapter 产出的安全 Markdown 图片行，不额外下载图片。
- 允许保留 `window.__gvExportM365Json()` 作为 M365 debug/dev only 本地验证入口，不作为最终 UI。
- 测试覆盖 JSON 可解析、metadata、turn 内容、assistant-only、user-only、image-only、DOM object 不外泄，并确认 Gemini export 不受影响。

已完成：

- `M365ExportService.buildJsonExport(conversation, title?)` 生成纯 JSON-safe payload。
- `M365ExportService.serializeJsonExport(conversation, title?)` 生成可被 `JSON.parse` 解析的 pretty JSON 字符串。
- JSON payload 顶层包含 `platform: "m365-copilot"`、`title`、`url`、`exportedAt`、`count`、`turns`。
- 每个 JSON turn 只包含 `user`、`assistant`、`starred`、`omitEmptySections`，不包含 `sourceElement`、`contentElement`、`userElement`、`assistantElement` 或 DOM object。
- image-only message 继续以安全 Markdown 图片行进入 JSON，不额外下载图片。
- `window.__gvExportM365Json()` 作为 M365 debug/dev only 入口，可在真机页面下载当前 JSON 并保存 `window.__gvLastM365JsonExport`。

当前限制：

- 仍未添加正式 M365 export UI。
- 暂不做正式 UI、PDF、Image export、timeline 或 chatWidth 接入。
- Debug/dev helper 仅用于本地验证，不作为产品入口。

### 5. M365 Markdown export MVP

目标是在不接入正式 UI、不调用 Gemini DOM extractor 的前提下，让 M365 canonical conversation 可以生成稳定 Markdown。

Plan 内容：

- 在 `M365ExportService.buildExportInput(conversation, title?)` 之上实现 Markdown MVP。
- 只做底层 Markdown serializer 和 debug/dev only 本地验证入口，不做正式 M365 export UI、PDF、Image export、timeline 或 chatWidth。
- 不重新扫描 M365 DOM，不复制 Gemini selectors，不修改 Gemini 现有导出逻辑。
- 新增 `buildMarkdownExport(conversation, title?)` 和 `serializeMarkdownExport(conversation, title?)`。
- Markdown 顶部包含 title、`platform: M365 Copilot`、`url`、`exportedAt` 和 `count`。
- 每个 turn 使用 `## Turn N`、`### User`、`### Assistant`，assistant-only 和 user-only turn 都保留可读输出。
- image-only message 保持当前 adapter 产出的安全 Markdown 图片行。
- 不把 `Element`、`HTMLElement`、`Node`、`sourceElement`、`contentElement`、`userElement`、`assistantElement` 写入 Markdown。

已完成：

- `M365ExportService.buildMarkdownExport(conversation, title?)` 生成可读 Markdown 字符串。
- `M365ExportService.serializeMarkdownExport(conversation, title?)` 作为 public serializer，与 JSON serializer 命名保持一致。
- Markdown serializer 复用 `buildExportInput()` / `buildTurns()`，所以继续消费 `CanonicalConversation`，不新增 DOM 扫描。
- Markdown 输出保留 user/assistant、assistant-only、user-only 和 image-only turns。
- 2026-04-29 追加修复：assistant canonical text 不再只取 flattened `textContent`，而是把常见 M365 assistant HTML 结构转换成 Markdown 文本，保留 `**粗体**`、`- 列表` 和段落空行。
- `window.__gvExportM365Markdown()` 作为 M365 debug/dev only 入口，可在真机页面下载当前 Markdown 并保存 `window.__gvLastM365MarkdownExport`。

当前限制：

- 仍未添加正式 M365 export UI。
- 暂不做 PDF、Image export、timeline 或 chatWidth 接入。
- Debug/dev helper 仅用于本地验证，不作为产品入口。

### 6. Image URL 安全边界

M365 image content 会被转换为 Markdown image 语法，因此 URL 必须先过滤。

当前允许：

- `http:`
- `https:`
- `blob:`
- `data:image/png;base64,...`
- `data:image/jpeg;base64,...`
- `data:image/webp;base64,...`
- `data:image/gif;base64,...`

当前拒绝：

- 空 URL
- 含空白、控制字符或 `)` 的 URL
- `javascript:` 等非安全协议
- `data:text/html,...`
- `data:image/svg+xml,...`
- 超过 `1_048_576` 字符的 data image URL

为什么这样改：

- 避免 SVG data URL 或超大 inline payload 流入 Markdown/PDF/Image export 路径。
- 保留常见 raster image data URL 的导出能力。

### 7. M365 最小导出 UI

目标是在 M365 Copilot 页面提供一个最小可用、M365-only 的导出入口，让用户不用再打开 console helper 也可以导出当前 canonical conversation。

Plan 内容：

- 只做 JSON 和 Markdown；不做 PDF、Image export、timeline、chatWidth，也不搬迁 Gemini 完整导出 UI。
- UI 放在右上角独立浮层，使用 M365 专用 `gv-m365-export-*` class、`data-gv-m365-export-*` attribute 和 `gv-m365-export-ui-style` style id。
- 导出 action 只调用 `M365ExportService.serializeJsonExport()` / `serializeMarkdownExport()`，并继续通过 `extractM365CanonicalConversation()` 获取 canonical conversation。
- 导出前用 `M365ExportService.buildTurns()` 判断是否存在可导出 turns；没有内容时只提示，不下载空文件。
- 文件名使用页面标题或默认 `M365 Copilot`，清理 Windows 非法字符和保留名，并追加 ISO 日期时间后缀。

已完成：

- 新增 `src/pages/content/m365ExportUi.ts`，包含 `startM365ExportUi()`、`runM365ExportAction()`、文件名清理和 Blob 下载逻辑。
- `src/pages/content/index.tsx` 只在 `m365.cloud.microsoft` 分支启动 `startM365ExportUi()`；Gemini `startExportButton()` 和 `ExportDialog` 未接入 M365。
- 右上角 UI 提供 `Export JSON` / `Export Markdown`，并显示轻量成功、失败或空内容状态。
- 新增 `src/pages/content/m365ExportUi.test.ts`，覆盖 JSON/Markdown serializer 调用、空 conversation 不下载、文件名 sanitization、DOM 元素不进入 Gemini-style turns、下载内容不含 DOM 泄漏标记，以及 UI/style idempotent 注入。

当前限制：

- 真实 M365 页面 smoke test 已确认右上角 UI 可见，JSON / Markdown 点击下载正常；未来仍需在更多真实 conversations 上补充内容质量验证。
- PDF、Image export、timeline 仍延期；chatWidth 已由后续 M365-only MVP 接入。

### 8. M365 chatWidth MVP

目标是在 `m365.cloud.microsoft` 页面提供一个轻量、可回滚的对话宽度增强，让宽屏下的 M365 Copilot 聊天内容更舒展，同时冻结现有 JSON / Markdown 导出主线。

Plan 内容：

- 只做 M365 页面布局增强，不做设置面板、timeline、PDF、Image export，不重构 export UI。
- 不修改 Gemini chatWidth、Gemini export、Gemini timeline，也不复用 Gemini selectors。
- 新增 `startM365ChatWidth()`，只在 `index.tsx` 的 `m365.cloud.microsoft` 分支启动。
- 注入独立 style id `gv-m365-chat-width-style`，使用 HTML marker class `gv-m365-chat-width-enabled`。
- CSS 只针对 M365 `chatMessageContainer...`、message article、`fai-UserMessage` / `fai-CopilotMessage` 容器，默认固定 wide mode，幂等注入。
- 不读取消息正文，不依赖 `CanonicalConversation` 或 `M365ExportService`，不改变 M365 消息提取逻辑。

已完成：

- 新增 `src/pages/content/m365ChatWidth.ts`，暴露 `startM365ChatWidth()` 和 `stopM365ChatWidth()`。
- `startM365ChatWidth()` 给 `document.documentElement` 添加 `gv-m365-chat-width-enabled`，并只注入一个 `#gv-m365-chat-width-style`。
- CSS 范围限定在 `html.gv-m365-chat-width-enabled` 下，使用 `[id^="chatMessageContainer"]`、`[role="article"]`、`fai-UserMessage`、`fai-CopilotMessage`、`fai-UserMessage__message`、`fai-CopilotMessage__content`，宽度上限为保守的 `1440px`。
- `src/pages/content/index.tsx` 只在 M365 分支调用 `startM365ChatWidth()`；Gemini 分支仍使用原 `startChatWidthAdjuster()`。
- 新增 `src/pages/content/m365ChatWidth.test.ts`，覆盖 style/marker 幂等、M365-only selector、Gemini selector/storage 禁止、export UI root 不被修改、无 canonical/export/message body 依赖，以及 cleanup。

当前限制：

- 用户在真实页面反馈第一版加宽未成功；CDP 检查确认 article CSS 已注入但仍被外层 `chatMessageContainer...` 和其下包装 div 限制到约 `852px` / `800px`。
- 已追加容器层 selector，fresh Edge + 最新 `dist_chrome` 的 CDP smoke 确认 message container 为 `1440px`、assistant content 约 `1388px`、user content 约 `1368px`。
- 输入框是否正常、Copilot 原生按钮/顶部栏/侧边栏/菜单是否完全不受影响，仍需用户在真实已登录、有消息的 M365 conversation 中人工视觉确认。
- 未来如 M365 DOM 布局变化，优先继续保守收紧 CSS selector，不引入 Gemini selector，也不读取消息正文。

### 9. M365 rich content sample validation

目标是验证并补强 M365 canonical extraction / JSON / Markdown export 在富内容对话中的表现，重点覆盖 image、code、table 和 link，同时保持 M365-only，不新增 UI，不做 timeline/PDF/Image export。

Plan 内容：

- 在现有 `M365ConversationExtractor` 内容渲染路径里补 table-to-Markdown，不新增 M365 DOM 扫描入口。
- 扩展测试覆盖 `pre` fenced code block、inline/multiline `code`、M365 残缺 code-fence 片段、safe/unsafe links、semantic table、table pipe escaping，以及 image metadata。
- 真机验证只使用 `window.__gvExtractCanonical()`、`window.__gvExportM365Json()`、`window.__gvExportM365Markdown()`，不运行自动 diagnostics，不新增页面 UI。

已完成：

- `src/pages/content/m365ConversationExtractor.ts` 新增 semantic table Markdown 渲染：只收集当前 table 的直属 rows，按最大列数补齐，生成 Markdown header/separator/body，并转义单元格内的 `|`。
- `src/pages/content/m365ConversationExtractor.ts` 新增 code-fence 归一化：`pre` 和多行 `code` 输出 fenced block；M365 偶发的语言标签 + 代码 + 残缺反引号片段会转成标准 fenced block。
- `src/pages/content/m365ChatExtractor.ts` 和 `src/pages/content/m365ExportUi.ts` 已改为稳定默认标题 `M365 Copilot`，避免 M365 `document.title` 把用户 prompt 作为 Markdown H1 或文件名。
- `src/pages/content/m365ChatExtractor.test.ts` / `m365ExportUi.test.ts` 新增富内容与标题回归 fixture，覆盖 code/pre、多行 code、safe link、unsafe href 退化为纯文本、semantic table、image `currentSrc` / `alt` / `title` / size metadata，以及导出标题稳定性。
- JSON / Markdown export 仍只消费 `CanonicalConversation`；本轮没有改 `M365ExportService` 的 public payload shape，也没有把 DOM element 写入导出。

当前限制：

- 本轮没有接入 PDF/Image export，也没有新增 M365 UI。
- 真实 image-message DOM 仍需要更多样本；本轮真实页面验证以 link/code/table 导出为主。

### 10. M365 timeline MVP

目标是在 `m365.cloud.microsoft` 页面提供一个轻量 M365-only timeline navigator，让宽屏阅读时可以通过右侧 marker 快速跳到对应 user prompt，同时保持 export、chatWidth 和 extraction 主线不变。

Plan 内容：

- 新增 `src/pages/content/m365Timeline.ts`，暴露 `startM365Timeline()` 和 `stopM365Timeline()`。
- 只在 `src/pages/content/index.tsx` 的 `m365.cloud.microsoft` 分支启动，和 diagnostics、chat extractor、export UI、chatWidth 并列；Gemini 分支继续使用原 `startTimeline()`。
- marker 数据只来自 `extractM365CanonicalConversation()` 与 `M365TimelineService.buildIndex(conversation)`，并过滤到 `role === "user"`。
- UI 使用独立 `#gv-m365-timeline-root`、`#gv-m365-timeline-style`、`#gv-m365-timeline-tooltip` 和 `gv-m365-timeline-*` class/data attributes。
- marker 是可聚焦 button，支持 hover/focus tooltip，点击后调用 `sourceElement.scrollIntoView({ block: "start", behavior: "smooth" })` 并标记 active。
- 使用一个 debounced `MutationObserver` 在页面动态变化后重建 markers；root/style/tooltip 注入保持幂等。
- 不做 storage、star/pin、preview panel、keyboard shortcuts，不复用 Gemini timeline manager，不引用 Gemini timeline selectors 或 storage keys，不新增消息正文扫描入口。

已完成：

- `src/pages/content/m365Timeline.ts` 已实现 M365-only timeline root/style/tooltip、user marker 渲染、tooltip、click-to-scroll、active marker 和 cleanup。
- `src/pages/content/m365Timeline.ts` 已补强 M365 虚拟列表场景：timeline 不再把当前可见 DOM 当作完整时间轴，而是按 conversation URL 缓存已见 user markers；当前 DOM 窗口只刷新可见 marker 的 source element，不会覆盖已见 marker 标题。
- `src/pages/content/index.tsx` 已在 M365 分支调用 `startM365Timeline()`；Gemini timeline/export/sidebar/chatWidth 启动逻辑保持不变。
- `src/pages/content/m365Timeline.test.ts` 覆盖 root/style/tooltip 幂等注入、只渲染 user markers、点击 canonical source element 滚动、tooltip 无 DOM 泄漏、export UI root 不被修改、无 Gemini selector/storage 引用、M365 虚拟列表卸载后的 marker 保留，以及 `stopM365Timeline()` cleanup。

当前限制：

- MVP 只显示 user-message markers，不做 assistant marker、滚动同步高亮、持久化状态或快捷键。
- 已见但当前 DOM 不可见的 marker 会保留为 stale marker；如果对应 `sourceElement` 尚未被 M365 重新挂载，点击时无法立即滚动到该旧消息。后续如要支持“点击旧 marker 触发 M365 加载历史”，需要额外研究 M365 原生滚动容器和加载机制。
- 真机视觉仍需要在更多已登录 M365 conversations 上确认 marker 与 M365 右侧滚动/菜单区域是否长期不冲突。

### 11. M365 settings UI MVP

目标是参考原 Gemini popup 的交互形态，为 M365 chatWidth 和 timeline 增加轻量设置入口，同时保持 M365-only 隔离，不迁移 Gemini selector、Gemini storage、star/pin、preview panel、PDF/Image export 或完整 timeline manager。

Plan 内容：

- 在 popup 中识别当前 active tab 是否为 `m365.cloud.microsoft`；M365 tab 下显示 M365 专用设置区，Gemini / AI Studio tab 保持原设置页。
- 新增 M365-only storage key：`gvM365ChatWidthEnabled`、`gvM365ChatWidthPercent`、`gvM365TimelineEnabled`、`gvM365TimelineScrollMode`，并预留 `gvM365TimelinePosition` 供 reset position 使用。
- `m365ChatWidth.ts` 改为默认开启，读取并监听 M365 storage；支持开关和宽度滑杆实时生效。
- `m365Timeline.ts` 改为默认开启，读取并监听 M365 storage；支持关闭 timeline，并支持 `flow` / `jump` 两种 scroll mode。
- popup UI 复用现有 `Card`、`Switch`、segmented control 和 `WidthSlider` 风格，不引入新视觉体系。

已完成：

- 新增 `src/pages/content/m365Settings.ts`，集中定义 M365 storage key、默认值、宽度 clamp 和 timeline mode normalization。
- `src/pages/content/m365ChatWidth.ts` 现在使用 `gvM365ChatWidthEnabled` / `gvM365ChatWidthPercent`；默认值为开启、`75vw`，并通过 `chrome.storage.onChanged` 实时更新或清理 style/marker。
- `src/pages/content/m365Timeline.ts` 现在使用 `gvM365TimelineEnabled` / `gvM365TimelineScrollMode`；关闭时会移除 timeline root/style/tooltip 并断开 observer，重新开启时幂等恢复；`flow` 使用 smooth scroll，`jump` 使用 auto scroll。
- `src/pages/popup/Popup.tsx` 在 M365 tab 下显示轻量 `M365 Copilot Settings`，包含 timeline 开关、flow/jump、reset position 和 chatWidth 开关/滑杆；Gemini / AI Studio tab 保持原设置视图。
- 新增 `src/pages/popup/__tests__/m365Settings.test.tsx`，并扩展 `m365ChatWidth.test.ts` / `m365Timeline.test.ts`，覆盖 M365 key 写入、默认开启、storage 关闭、宽度 clamp、scroll mode 和不写 Gemini key。

当前限制：

- M365 settings MVP 只覆盖 chatWidth 和 timeline；不迁移 Gemini star/pin、preview panel、keyboard shortcuts、拖拽定位或完整 timeline settings。
- `gvM365TimelinePosition` 目前只是 reset position 预留 key；本轮没有实现 M365 timeline 拖拽位置。
- 真机 storage 实时生效已在用户已登录 M365 conversation 页面通过 Edge/CDP 验证；工具栏 popup 视觉仍建议由用户手动点开扩展按钮做最终确认。

### 12. M365 Export UI 与 Timeline 视觉优化

目标是让 M365 导出入口更接近 Voyager 的轻量弹窗体验，同时只对 timeline 做视觉对齐优化；不迁移 Gemini selector、storage key、timeline manager、preview panel、star/pin、拖拽、PDF 或 Image export。

Plan 内容：

- 把 M365 右上角两个常驻导出按钮改成一个固定 `Export` trigger。
- 点击 trigger 后显示 M365-only 弹窗，提供 JSON / Markdown 两个格式选项、说明文字、Cancel / Export 按钮和清晰 hover/focus 状态。
- 导出动作继续调用 `runM365ExportAction('json' | 'markdown')`，不改变 canonical extraction、serializer、filename 和安全过滤逻辑。
- 成功/失败状态改为独立 M365-only toast，避免按钮区高度跳动。
- Timeline 保持 user-message markers、canonical summary tooltip、click-to-scroll、`flow` / `jump` 行为不变，只优化 rail、marker、active、stale 和 tooltip 的视觉。
- Timeline 位置保持用户已认可的原位置，不擅自贴近浏览器滚动条；不迁移 Voyager preview/search/star/drag/slider 或 Gemini timeline manager。

已完成：

- `src/pages/content/m365ExportUi.ts` 保留 `#gv-m365-export-ui-root` / `#gv-m365-export-ui-style`，新增单 `Export` trigger、`#gv-m365-export-dialog` 和 `#gv-m365-export-toast`。
- M365 Export 弹窗使用 `gv-m365-export-*` class/data attributes；JSON / Markdown 选择和 Cancel、外部点击、Escape 关闭都在 root 内处理。
- `runM365ExportAction()` 路径未改，JSON / Markdown 仍只消费 `extractM365CanonicalConversation()` 与 `M365ExportService`。
- `src/pages/content/m365Timeline.ts` 只更新注入 CSS；root/style/tooltip id、marker 数据、缓存逻辑、click-to-scroll 和 storage 设置行为均保持原实现。
- 用户反馈 visual pass 后的 timeline 仍挡住 M365 原生右侧滚动条；本轮把 timeline root 左移到 `right: 28px`，并将 rail 本身改为 `pointer-events: none`，只让 marker button 保持可点击，给最右侧原生滚动条留出视觉和交互空间。
- `m365ExportUi.test.ts` 覆盖单 root/style/trigger、弹窗打开、JSON/Markdown action、Cancel/外部点击/Escape 关闭、toast 不移除 export/timeline root、无 Gemini dialog class 或 storage 引用。
- `m365Timeline.test.ts` 覆盖视觉 class 仍为 `gv-m365-timeline-*`、active/stale/tooltip 命名保持隔离、rail 不拦截原生滚动条区域、CSS 不引用 Gemini timeline selector/storage，marker click 和 `flow` / `jump` 行为继续通过。

当前限制：

- 本轮 Export UI 仍只支持 JSON / Markdown；PDF/Image export 继续延期。
- 本轮 timeline 只做视觉优化，不做 preview panel、search、star/pin、marker level、拖拽定位、滚动同步或完整 Gemini timeline 生态。
- 程序化验证已通过；真实 M365 页面 reload 后仍需要用户或后续 Codex 做最终视觉确认，重点看 Export 弹窗、timeline 位置和原生右侧轨道是否舒适。

### 13. M365 timeline 右侧滚动条避让修复

目标是修复用户指出的真实 M365 原生右侧滚动条遮挡问题：timeline 不能只靠 `pointer-events: none` 让滚动事件穿透，还必须在视觉上向左避开滚动条。

已完成：

- `#gv-m365-timeline-root` 调整为 `right: 28px`，把 marker 和 rail 从最右侧原生滚动条区域移开。
- `.gv-m365-timeline-rail` 保持 `pointer-events: none`，避免 rail 拦截原生滚动条区域。
- `.gv-m365-timeline-marker` 保持 `pointer-events: auto`，marker 点击、active 状态和 `flow` / `jump` 滚动行为继续可用。
- 真机复测确认 timeline root 为 `right: 28px`，marker 右边缘距离视口右侧约 `25px`；M365 原生滚动条在最右侧，timeline dot 已位于其左侧；Export UI、timeline、chatWidth 均保持单实例。

当前限制：

- 这次只修复 timeline 与原生滚动条的视觉/交互冲突；不实现 `gvM365TimelinePosition` 拖拽定位。
- PDF/Image export 和真实 image-message 样本仍然 pending，不能记录为真机通过。

### 14. M365 chatWidth conversation + new chat 真机硬化验证

目标是先在真实 M365 页面验证 ChatWidth，而不是预防性改 CSS。覆盖已有 conversation 页和新聊天页，确认消息区放宽、输入框不被误伤、Export UI/timeline 共存、storage 开关实时生效。

已完成：

- 重建 `L:\project\dist_chrome`，并用专用 Edge profile + CDP `9225` 加载真实 M365 页面。
- conversation 页验证通过：`#gv-m365-chat-width-style` 为 1，HTML root 含 `gv-m365-chat-width-enabled`；80vw message container 约 `1530px`，88vw 时约 `1604px`，没有退回旧 `852px` 限制。
- conversation 页兼容检查通过：无横向溢出，Export UI root/style、timeline root/style、timeline marker 均保持单实例，diagnostics marker 为 0。
- storage 实时切换通过：关闭 `gvM365ChatWidthEnabled` 会移除 style 和 HTML marker；重新开启并设置 `gvM365ChatWidthPercent: 88` 会注入 `88vw` CSS；最后恢复本轮开始前的 `80`。
- new chat 页验证通过：没有 message container / article / content nodes，输入框保持约 `752px`，ChatWidth 关闭、88vw、恢复都不会错误放宽输入框或造成横向溢出。
- Console 只观察到 M365 原生 CSP warning 和 profile photo 404，未观察到 Voyager/M365 ChatWidth 相关 exception。

当前限制：

- 本轮没有改代码，因为实测没有发现需要修复的 ChatWidth CSS 问题。
- 本轮不实现 `gvM365TimelinePosition`，不修改 timeline/export 行为，不接 PDF/Image。

## 验证记录

2026-05-01 M365 chatWidth 硬化验证后通过：

```powershell
npm.cmd run build:chrome
npm.cmd exec -- prettier --check M365_COPILOT_CONTEXT.md M365_CHANGELOG.md
git diff --check
```

验证结果：

- `build:chrome` 在 sandbox 内首次遇到已知 `esbuild spawn EPERM`，随后在真实 Windows 权限下重跑同一命令通过；Vite 仅输出既有 dynamic import、重复 icon asset 和大 chunk warnings。
- conversation 页：`Voyager` isolated world helpers 和 `chrome.storage.sync` 存在；ChatWidth style/root 单实例，80vw message container 约 `1530px`，88vw 时约 `1604px`，关闭/恢复实时生效，无横向溢出。
- conversation 页：Export UI root/style 为 1，timeline root/style 为 1，timeline marker 为 2，diagnostics marker 为 0；输入框、顶部栏、侧边栏和右侧轨道均有可见 geometry。
- new chat 页：ChatWidth style/root 单实例，message container/article/content 均为 0，输入框约 `752px`；关闭/88vw/恢复不会错误放宽输入框，无横向溢出。
- Console 采样只记录 M365 原生 CSP warning 和 profile photo 404；未记录 Voyager/M365 ChatWidth exception。
- 因未改 `.ts` / `.tsx`，本轮不跑 targeted Vitest/typecheck/eslint；只做文档格式与 whitespace 检查。

2026-04-30 M365 timeline 右侧滚动条避让修复后通过：

```powershell
npm.cmd run test -- src/pages/content/m365ChatExtractor.test.ts src/pages/content/m365FeatureServices.test.ts src/pages/content/m365ExportUi.test.ts src/pages/content/m365ChatWidth.test.ts src/pages/content/m365Timeline.test.ts src/pages/popup/__tests__/m365Settings.test.tsx
npm.cmd run typecheck
npm.cmd exec -- eslint src/pages/content/m365*.ts src/pages/content/m365*.test.ts
npm.cmd exec -- prettier --check src/pages/content/m365*.ts src/pages/content/m365*.test.ts M365_COPILOT_CONTEXT.md M365_CHANGELOG.md
npm.cmd run build:chrome
git diff --check
```

验证结果：

- M365 + popup 回归：73 passed。
- `typecheck`、eslint、Prettier check、`build:chrome`、`git diff --check` 均通过。
- 真机复测使用 `L:\project\dist_chrome`、`https://m365.cloud.microsoft/chat/conversation/3a9c838f-bbfd-48aa-a85f-4e9570d20ac8` 和 CDP `9225`；在 `Voyager` isolated world 中确认 helper 存在，timeline 不压住最右侧原生滚动条，marker 点击仍可 active / jump。
- 本地提交为 `e90f577 fix(m365): keep timeline off native scrollbar`，但截至本快照尚未 push 到 GitHub。

2026-04-30 M365 Export UI 与 Timeline 视觉优化后通过：

```powershell
npm.cmd run test -- src/pages/content/m365ChatExtractor.test.ts src/pages/content/m365FeatureServices.test.ts src/pages/content/m365ExportUi.test.ts src/pages/content/m365ChatWidth.test.ts src/pages/content/m365Timeline.test.ts src/pages/popup/__tests__/m365Settings.test.tsx
npm.cmd run typecheck
npm.cmd exec -- eslint src/pages/content/m365*.ts src/pages/content/m365*.test.ts
npm.cmd exec -- prettier --check src/pages/content/m365*.ts src/pages/content/m365*.test.ts M365_COPILOT_CONTEXT.md M365_CHANGELOG.md
npm.cmd run build:chrome
git diff --check
```

验证结果：

- Targeted tests：6 个 test files、72 个 tests 全部通过。
- `typecheck` 通过。
- M365 content files eslint 通过。
- Prettier check 通过；`m365ExportUi.test.ts` 先由 Prettier 写回后复测通过。
- `build:chrome` 通过；Vite 仅输出既有 dynamic import、重复 icon asset 和大 chunk warnings。
- `git diff --check` 通过。
- 初次沙箱内运行 Vitest 遇到已知 Windows `esbuild spawn EPERM`，按既有流程在提升后的真实 Windows 环境重跑同一条 `npm.cmd` 命令后通过。
- 真机复测：Codex 重建 `L:\project\dist_chrome`，重启临时 Edge profile 并打开真实 M365 conversation `https://m365.cloud.microsoft/chat/conversation/3a9c838f-bbfd-48aa-a85f-4e9570d20ac8`；`Voyager` isolated world 存在，`window.__gvExtractCanonical` / `window.__gvExportM365Json` / `window.__gvExportM365Markdown` 均为 function，canonical 共 4 条 messages / 2 条 user messages。
- 真机 UI 检查：`#gv-m365-export-ui-root`、`#gv-m365-export-ui-style`、单 `Export` trigger、dialog、timeline root/style/tooltip、chatWidth style 均为 1；旧 `[data-gv-m365-export-format]` 两按钮为 0。点击 Export 后弹窗显示 JSON / Markdown，Escape 可关闭。
- 真机视觉发现并修复：第一轮截图显示顶部 timeline tooltip 会贴近/覆盖 Export 区域；`showTimelineTooltip()` 已改为读取 `#gv-m365-export-ui-root` rect 并在相交时左移避让，新增回归测试覆盖该场景。重建并重启 Edge 后复测确认 tooltip rect 与 Export rect 不相交，`intersectsExport === false`，marker click 后 active 正常。
- 用户随后反馈 timeline 过多占用原生右侧滚动条区域；已将 root 调整为 `right: 28px`，并把 `.gv-m365-timeline-rail` 改为 `pointer-events: none`，保留 `.gv-m365-timeline-marker` 的 `pointer-events: auto`。新增回归测试确认 rail 不再拦截，targeted timeline 测试 17 个用例通过。
- Console 采样只观察到 M365 原生 CSP warning / 404 / CORS 资源错误，未观察到 Voyager/M365 UI 相关 exception；本轮没有触发真实导出下载，避免额外保存当前 conversation 内容。

2026-04-30 M365 settings UI MVP 接入后通过：

```powershell
npm.cmd run test -- src/pages/content/m365ChatExtractor.test.ts src/pages/content/m365FeatureServices.test.ts src/pages/content/m365ExportUi.test.ts src/pages/content/m365ChatWidth.test.ts src/pages/content/m365Timeline.test.ts src/pages/popup/__tests__/m365Settings.test.tsx
npm.cmd run typecheck
npm.cmd exec -- eslint src/pages/content/m365*.ts src/pages/content/m365*.test.ts src/pages/popup/Popup.tsx src/pages/popup/__tests__/m365Settings.test.tsx
npm.cmd exec -- prettier --check src/pages/content/m365*.ts src/pages/content/m365*.test.ts src/pages/popup/Popup.tsx src/pages/popup/__tests__/m365Settings.test.tsx M365_COPILOT_CONTEXT.md M365_CHANGELOG.md
npm.cmd run build:chrome
git diff --check
```

验证结果：

- Targeted tests：6 个 test files、65 个 tests 全部通过。
- `typecheck` 通过。
- M365 content files、popup 和新增 popup test 的 eslint 通过。
- Prettier check 通过。
- `build:chrome` 通过；Vite 仅输出既有 dynamic import、重复 icon asset 和大 chunk warnings。
- `git diff --check` 通过。
- 真机 CDP 验证：Codex 启动 Edge 加载 `L:\project\dist_chrome`，打开真实 M365 conversation `https://m365.cloud.microsoft/chat/conversation/3a9c838f-bbfd-48aa-a85f-4e9570d20ac8`，在 `Voyager` isolated world 确认 `chrome.storage.sync` 可用，`window.__gvExtractCanonical` / `window.__gvExportM365Json` / `window.__gvExportM365Markdown` 均为 function。
- 默认状态下 `#gv-m365-chat-width-style` 为 1、`gv-m365-chat-width-enabled` 存在、`#gv-m365-timeline-root` 为 1、`#gv-m365-timeline-style` 为 1、timeline marker 为 2、`#gv-m365-export-ui-root` 为 1。
- storage 实时切换通过：写入 `gvM365ChatWidthEnabled: false` / `gvM365TimelineEnabled: false` 后，chatWidth style/root marker 和 timeline root/style/markers 均清理，export UI root 仍为 1；写入 `gvM365ChatWidthEnabled: true`、`gvM365ChatWidthPercent: 88`、`gvM365TimelineEnabled: true`、`gvM365TimelineScrollMode: "jump"` 后，chatWidth style 恢复且包含 `88vw`，timeline root/style/markers 恢复；最后恢复默认 `75` / `flow`。
- timeline 点击行为真机验证通过：`jump` 模式点击 marker 调用 `scrollIntoView({ block: "start", behavior: "auto" })`，`flow` 模式调用 `scrollIntoView({ block: "start", behavior: "smooth" })`，目标元素为 M365 user message source element。
- 工具栏 popup 视觉验收仍建议手动点开扩展按钮确认；本轮程序化打开 popup 时测试 Edge/CDP 会话已退出，因此未把 popup 视觉记为真机通过。

2026-04-29 M365 timeline MVP 接入后通过：

```powershell
npm.cmd run test -- src/pages/content/m365ChatExtractor.test.ts src/pages/content/m365FeatureServices.test.ts src/pages/content/m365ExportUi.test.ts src/pages/content/m365ChatWidth.test.ts src/pages/content/m365Timeline.test.ts
npm.cmd run typecheck
npm.cmd exec -- eslint src/pages/content/m365*.ts src/pages/content/m365*.test.ts
npm.cmd exec -- prettier --check src/pages/content/m365*.ts src/pages/content/m365*.test.ts M365_COPILOT_CONTEXT.md M365_CHANGELOG.md
npm.cmd run build:chrome
git diff --check
```

验证结果：

- Targeted tests：5 个 test files、56 个 tests 全部通过；新增 2 个 M365 虚拟列表回归用例，覆盖 marker 不缩水和标题不被 disjoint visible window 覆盖。
- `typecheck` 通过。
- M365 目标文件 eslint 通过。
- Prettier check 通过；新增 timeline 文件先由 Prettier 写回后复测通过。
- `build:chrome` 通过；sandbox 内仍会遇到已知 `esbuild spawn EPERM`，提升到真实 Windows 环境重跑同一命令后通过，Vite 仅输出既有 chunk/asset warnings。
- `git diff --check` 通过。
- 真机 smoke test：Codex 启动带 CDP 的 Edge 测试窗口，加载最新 `L:\project\dist_chrome` 并打开真实 M365 conversation `https://m365.cloud.microsoft/chat/conversation/3a9c838f-bbfd-48aa-a85f-4e9570d20ac8`。在 `Voyager` isolated world 中确认 `window.__gvExtractCanonical()` 可用，canonical 共 4 条 messages / 2 条 user messages，timeline marker 数为 2，`#gv-m365-timeline-root`、`#gv-m365-timeline-style`、`#gv-m365-timeline-tooltip` 均为 1。
- 真机交互检查：第一枚 marker hover/focus 后 tooltip 显示 user prompt summary；click 后 marker 被标记为 active，说明事件监听与 scroll action 路径已触发。刷新页面后 root/style/tooltip 仍各 1 个，marker 仍为 2，未重复注入。
- 兼容检查：同一页面中 `#gv-m365-export-ui-root` 为 1、`#gv-m365-chat-width-style` 为 1、diagnostics marker 为 0，timeline CSS 不含 Gemini selector/storage key。短时间 console 捕获到 M365 原生网络 404/CORS/resource error，但未观察到 Voyager/M365 timeline 相关 exception。
- 用户随后反馈真实 M365 向上翻历史时，由于 M365 惰性加载会自动卸载不可见对话，timeline 节点会从 4 个变成 3 个，且标题被当前 DOM 窗口里的其他 prompt 覆盖。本次已追加回归修复：按 conversation URL 缓存已见 user markers，并使用 canonical fingerprint/summary 作为稳定 key；新增测试覆盖“可见窗口减少一个 user message 时 marker 不缩水”和“完全不同可视窗口不会覆盖旧 marker 标题”。

2026-04-29 M365 rich content extraction 补强后通过：

```powershell
npm.cmd run test -- src/pages/content/m365ChatExtractor.test.ts src/pages/content/m365FeatureServices.test.ts src/pages/content/m365ExportUi.test.ts src/pages/content/m365ChatWidth.test.ts
npm.cmd run typecheck
npm.cmd exec -- eslint src/pages/content/m365*.ts src/pages/content/m365*.test.ts
npm.cmd exec -- prettier --check src/pages/content/m365*.ts src/pages/content/m365*.test.ts M365_COPILOT_CONTEXT.md M365_CHANGELOG.md
npm.cmd run build:chrome
git diff --check
```

验证结果：

- Targeted tests：4 个 test files、44 个 tests 全部通过。
- `typecheck` 通过。
- M365 目标文件 eslint 通过。
- Prettier check 通过。
- `build:chrome` 通过；沙箱内遇到已知 `esbuild spawn EPERM` 后，提升到真实 Windows 环境重跑同一条命令通过，Vite 仅输出既有 chunk/asset warnings。
- `git diff --check` 通过。
- 真机验证：Codex 在真实 M365 页面发送无敏感测试 prompt，请求 Copilot 返回 link、fenced code block 和 table；随后通过现有 M365 JSON / Markdown export helper 导出文件。用户检查 `D:/Downloads/m365-copilot-2026-04-29T05-55-37-676Z.json` 与 `D:/Downloads/m365-copilot-2026-04-29T05-55-37-678Z.md` 后确认两个文件正确。
- 预览异常修复：用户随后发现 `.md` 在 VS Code 预览中 H1 变成 prompt，且 code block 没有形成标准 fenced block。原因是导出标题读取了 M365 `document.title`，并且真实 M365 code block 没有稳定落入现有 `<pre>` 分支。本轮已改为稳定标题并补充 code-fence 归一化。
- 修复后真机复测：Codex 启动 Edge 加载最新 `L:\project\dist_chrome`，在真实 M365 页面发送无敏感测试 prompt，并通过现有 helper 导出 `m365-copilot-2026-04-29T09-36-28-344Z.json` / `m365-copilot-2026-04-29T09-36-28-346Z.md`。机器检查确认 JSON 可 parse、`platform === "m365-copilot"`、title 为 `M365 Copilot`、Markdown 以 `# M365 Copilot` 开头且不是 prompt、包含 ```json fenced code block、无残缺反引号尾巴、包含表格与 `JSON \| Markdown` 转义单元格、包含 https link、无 DOM 字段泄漏、export UI root 为 1、chatWidth style 为 1、diagnostics marker 为 0。
- 追加自主真机复测：用户授权 Codex 不再等待人工操作后，Codex 复用真实 Edge/CDP 环境在 `https://m365.cloud.microsoft/chat` 中发送无敏感 rich-content prompt。首轮结果确认 JSON/Markdown helper 可用、JSON 可 parse、title 稳定、Markdown table / `JSON \| Markdown` / https link / DOM 泄漏检查通过、export UI root 为 1、chatWidth style 为 1、diagnostics marker 为 0；但 Copilot 首轮未实际返回 fenced code block。
- 误判纠正：Codex 随后发送只要求返回 code block 的极小 prompt，但初次检查整段 Markdown 时误把 User prompt 中的 fenced block 算进了通过结果。用户指出问题后，Codex 改为只检查 `role === "assistant"` 的 canonical messages，确认真实 Assistant 输出仍是 `JSON` 标签 + 普通文本代码，缺少 fenced block。
- 修复与最终真机复测：`src/pages/content/m365ConversationExtractor.ts` 新增 M365 language-label code block 归一化；`src/pages/content/m365ChatExtractor.test.ts` 新增回归测试，覆盖 `JSON` 标签后跟普通文本代码、随后接 Markdown table 的真实形态。重建 `L:\project\dist_chrome` 并重启专用 Edge 测试 profile 后，assistant-only 复查确认 `firstAssistantHasJsonFence === true`、`lastAssistantHasJsonFence === true`、`lastAssistantContainsUserPrompt === false`；最终导出检查确认 4 条 canonical messages、2 个 turns、JSON 可 parse、`platform === "m365-copilot"`、Markdown title 稳定、table/link/code 结构存在、无残缺反引号尾巴、DOM 泄漏检查通过、export UI root 为 1、chatWidth style 为 1、diagnostics marker 为 0。
- 真实 image-message 样本仍 pending；本轮只保留自动化覆盖，不伪造 image 真机通过。

2026-04-29 M365 chatWidth MVP 接入后通过：

```powershell
npm.cmd run test -- src/pages/content/m365ChatExtractor.test.ts src/pages/content/m365FeatureServices.test.ts src/pages/content/m365ExportUi.test.ts src/pages/content/m365ChatWidth.test.ts
npm.cmd run typecheck
npm.cmd exec -- eslint src/pages/content/m365*.ts src/pages/content/m365*.test.ts
npm.cmd exec -- prettier --check src/pages/content/m365*.ts src/pages/content/m365*.test.ts M365_COPILOT_CONTEXT.md M365_CHANGELOG.md
npm.cmd run build:chrome
git diff --check
```

验证结果：

- Targeted tests：4 个 test files，40 个 tests 全部通过。
- `typecheck` 通过。
- M365 目标文件 eslint 通过。
- Prettier check 通过。
- `build:chrome` 通过；沙箱内先遇到已知 `esbuild spawn EPERM`，提升到真实 Windows 环境重跑同一条命令通过，Vite 仅输出既有 chunk/asset warnings。
- `git diff --check` 通过。
- 真实页面 CDP smoke test：新 Edge profile 加载 `L:\project\dist_chrome` 并打开 `https://m365.cloud.microsoft/chat?redirfrom=CsrToSSR`；机器检查确认 `#gv-m365-chat-width-style` 数量为 1、`gv-m365-chat-width-enabled` marker 存在、style 包含 M365 selectors 且不含 Gemini selectors、右上角 export UI root 仍存在。
- 用户反馈第一版真实页面未加宽；随后 CDP 检查确认外层 `chatMessageContainer...` 仍限制宽度，追加容器层规则后，用最新 `dist_chrome` 打开 fresh Edge 验证：message container 为 `1440px`，assistant article 为 `1436px`，assistant content 为 `1388px`，user content 为 `1368px`。
- 真实视觉验收剩余项：输入框可用、顶部栏/侧边栏/菜单未被破坏，需要用户在真实已登录对话页人工确认后再回写。

2026-04-29 M365 最小导出 UI 接入后通过：

```powershell
npm.cmd run test -- src/pages/content/m365ChatExtractor.test.ts src/pages/content/m365FeatureServices.test.ts src/pages/content/m365ExportUi.test.ts
npm.cmd run typecheck
npm.cmd exec -- eslint src/pages/content/m365*.ts src/pages/content/m365*.test.ts
npm.cmd exec -- prettier --check src/pages/content/m365*.ts src/pages/content/m365*.test.ts M365_COPILOT_CONTEXT.md M365_CHANGELOG.md
npm.cmd run build:chrome
```

验证结果：

- Targeted tests：3 个 test files，34 个 tests 全部通过。
- `typecheck` 通过。
- M365 目标文件 eslint 通过。
- Prettier check 通过。
- `build:chrome` 通过；Vite 仅输出既有 chunk/asset warnings。
- Codex sandbox 运行 Vitest 和 `build:chrome` 时遇到已知 `esbuild spawn EPERM`，提升到真实 Windows 环境后重跑同一条 `npm.cmd` 命令通过。
- 真机 smoke test：Codex 启动独立 Edge 测试窗口，加载 `L:\project\dist_chrome` 并打开 M365 Copilot；用户确认右上角 `Export JSON` / `Export Markdown` 最小 UI 可见，两个按钮点击下载结果均正常。

2026-04-29 M365 Markdown HTML 结构保真修复后通过：

```powershell
npm.cmd run test -- src/pages/content/m365ChatExtractor.test.ts src/pages/content/m365FeatureServices.test.ts
npm.cmd run typecheck
npm.cmd exec -- eslint src/pages/content/m365*.ts src/pages/content/m365*.test.ts
npm.cmd exec -- prettier --check src/pages/content/m365*.ts src/pages/content/m365*.test.ts M365_COPILOT_CONTEXT.md M365_CHANGELOG.md AGENTS.md CLAUDE.md
npm.cmd run build:chrome
git diff --check
```

验证结果：

- Targeted tests：2 个 test files，27 个 tests 全部通过；新增覆盖 assistant HTML 中的粗体、段落和列表转 Markdown。
- `typecheck` 通过。
- M365 目标文件 eslint 通过。
- Prettier check 通过。
- `build:chrome` 通过；沙箱内遇到已知 `esbuild spawn EPERM` 后，在提升后的真实 Windows 环境重跑通过，Vite 仅输出既有 chunk/asset warnings。
- 真机验证：Edge reload `L:\project\dist_chrome` 后，在 M365 页面 `Voyager` isolated world 运行 `window.__gvExportM365Markdown()`，导出 `m365-copilot-2026-04-28T16-23-59-118Z.md`；机器检查确认包含 `**粗体**`、`- 列表`、段落空行且无 DOM 泄漏标记，用户人工查看后确认“新版正常”。

2026-04-28 M365 Markdown export MVP 后通过：

```powershell
npm.cmd run test -- src/pages/content/m365ChatExtractor.test.ts src/pages/content/m365FeatureServices.test.ts
npm.cmd run typecheck
npm.cmd exec -- eslint src/pages/content/m365*.ts src/pages/content/m365*.test.ts
npm.cmd exec -- prettier --check src/pages/content/m365*.ts src/pages/content/m365*.test.ts M365_COPILOT_CONTEXT.md M365_CHANGELOG.md
npm.cmd run build:chrome
```

验证结果：

- Targeted tests：2 个 test files，26 个 tests 全部通过；沙箱内首次遇到已知 `esbuild spawn EPERM` 后，在提升后的真实 Windows 环境重跑通过。
- `typecheck` 通过。
- M365 目标文件 eslint 通过。
- Prettier check 通过。
- `build:chrome` 通过；沙箱内首次遇到已知 `esbuild spawn EPERM` 后，在提升后的真实 Windows 环境重跑通过，Vite 仅输出既有 chunk/asset warnings。

2026-04-28 M365 JSON export MVP 后通过：

```powershell
npm.cmd run test -- src/pages/content/m365ChatExtractor.test.ts src/pages/content/m365FeatureServices.test.ts
npm.cmd run typecheck
npm.cmd exec -- eslint src/pages/content/m365*.ts src/pages/content/m365*.test.ts
npm.cmd exec -- prettier --check src/pages/content/m365*.ts src/pages/content/m365*.test.ts M365_COPILOT_CONTEXT.md M365_CHANGELOG.md
npm.cmd run build:chrome
git diff --check
```

验证结果：

- Targeted tests：2 个 test files，23 个 tests 全部通过。
- `typecheck` 通过。
- M365 目标文件 eslint 通过。
- Prettier check 通过。
- `build:chrome` 通过。
- `git diff --check` 通过。

2026-04-28 用户真机手动验证：

- Codex 启动 Windows Edge 测试窗口，加载 `L:\project\dist_chrome`，并开放 CDP 端口 `9225`。
- 用户在 M365 Copilot 页面按 `Voyager` isolated world 流程运行 `window.__gvExportM365Json()`。
- JSON 文件已成功导出，用户检查文件内容后确认看起来正常。
- 该结果表示 M365 JSON export MVP 的本地真机路径已打通：扩展加载、M365 canonical extraction、JSON serialization、debug/dev download helper 都能串起来。
- 仍未接入正式 M365 export UI；后续 UI 接入需要另行设计和验证。

环境注意：

- 在 Codex sandbox 里，Vitest/Vite 可能因为 `esbuild spawn EPERM` 失败。
- 遇到这个错误时，需要在提升后的真实 Windows 环境重跑同一条 `npm.cmd` 命令。
- Windows 本地优先使用 `npm.cmd`，不要直接使用 `npm.ps1`。

## 后续修改规则

后续 Codex 修改 M365 相关功能时，必须遵守：

- 先读 `M365_COPILOT_CONTEXT.md` 和本文件。
- 不复制 Gemini DOM selectors 到 M365。
- 不让 export、timeline、layout 各自扫描 M365 DOM。
- 不默认运行 diagnostics；手动 diagnostics 只能作为人工排查入口。
- 不新增 M365 UI，除非任务明确要求。
- 不改变 Gemini 现有行为。
- 更新 M365 selectors、canonical shape、extractor output、安全策略、测试命令或真实浏览器验证流程时，必须同时更新 `M365_COPILOT_CONTEXT.md` 和本文件。
- 新任务如果有明确 plan，必须把 plan 的目标、范围、关键接口、测试要求、延期项和最终验证结果合并进 `M365_COPILOT_CONTEXT.md` 和本文件；不要只记录代码结果。
- 每次开发完成后，后续 Codex 必须把用户当作代码新手：先用简明语言解释本次改动、关键文件和风险点，再陪用户跑一遍可复现的真实测试流程，最后根据测试结果更新 `M365_COPILOT_CONTEXT.md` 和本文件。
- 面向用户的输出默认使用中文；plan / proposed_plan 可以使用英文。
- 每次任务完成后按项目规则提交 Git；如果工作区已有无关 staged 文件，提交时必须使用显式 pathspec 避免误带。

## 下一步建议

优先级从高到低：

1. 采集真实 M365 image-message DOM，确认图片尺寸、alt/title/currentSrc 行为。
2. 只读验证 export adapter 在更多 conversation 上的 turns 输出，不接 UI。
3. 在更多真实 M365 conversations 上继续验证复杂 rich Markdown fidelity，尤其是嵌套列表、复杂表格和混合格式。
4. 在更多真实 M365 conversations 中验证 timeline marker 可见性、tooltip 与 click-to-scroll；如后续增加滚动同步，也只能基于 `CanonicalMessage.sourceElement`。
5. 在更多屏幕尺寸下观察 M365 chatWidth；如发现问题，只处理 CSS/layout，并且只使用 M365-only selector 或必要的 canonical source elements。
6. 在准备生产发布前，重新评估是否删除 `m365Diagnostics.ts`，或继续保持手动 gate。

## 给下一位 Codex 的提醒

开始前先确认：

- `git status --short --branch`
- 是否存在无关 staged 文件
- 当前 HEAD 是否包含 `09580fc`
- `M365_COPILOT_CONTEXT.md` 和本文件是否与最新代码同步

如果你继续 M365 迁移，请把新进度写进两个地方：

- `M365_COPILOT_CONTEXT.md`：写压缩事实和当前状态。
- `M365_CHANGELOG.md`：写详细变更、原因、验证、风险和下一步。

如果你先写了 plan 或收到用户给出的 plan，请在实现完成后同步：

- plan 原始目标和明确不做的范围。
- 实际落地的接口、入口和行为。
- 测试与验收覆盖。
- 没有落地、仍延期或需要未来 UI 接入的部分。

每次完成开发后，还要主动完成一次“给代码新手的交接”：

- 用几句话解释本次改了什么文件、解决了什么问题、没有做什么。
- 给出用户能照着做的测试流程，并尽量由 Codex 先完成构建、启动浏览器、准备命令等机器可做部分。
- 等用户完成必须人工参与的测试后，把真实结果写回 `M365_COPILOT_CONTEXT.md` 和本文件。
