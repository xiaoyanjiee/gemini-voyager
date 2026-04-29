# M365 Copilot 变更与进度文档

最后更新：2026-04-29
当前状态：M365 canonical baseline、export adapter baseline、JSON export MVP 和 Markdown export MVP 底层能力已落地，diagnostics 已改为手动 gate
配套上下文：`M365_COPILOT_CONTEXT.md`

后续 Codex 会话开始修改 M365 相关代码前，必须先阅读本文件和 `M365_COPILOT_CONTEXT.md`。任何改变 M365 selectors、canonical model、extractor 输出、export adapter、安全策略、浏览器验证流程或迁移优先级的任务，都必须同时更新这两个文档。

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

最近关键提交：

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
- `window.__gvExportM365Json()` / `window.__gvExportM365Markdown()` 是仅用于本地验证的 M365 debug/dev 入口，会下载当前页面 JSON / Markdown 并保存对应的 `window.__gvLastM365*Export`。
- Export adapter 已接入 M365-only 最小 UI，支持 JSON / Markdown；不改变 Gemini export 行为。

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

- 真实 M365 页面上的人工点击验证仍需在 build 后加载 `L:\project\dist_chrome` 到 Edge，并在登录态 M365 Copilot 页面操作 UI。
- PDF、Image export、timeline、chatWidth 仍延期。

## 验证记录

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

1. 在更多真实 M365 conversations 上验证 canonical extraction，尤其是 image/code/table/link 样本。
2. 采集真实 M365 image-message DOM，确认图片尺寸、alt/title/currentSrc 行为。
3. 只读验证 export adapter 在更多 conversation 上的 turns 输出，不接 UI。
4. 设计 M365 timeline markers，但数据源必须是 `CanonicalMessage`。
5. 设计 M365 layout enhancer，只处理 CSS/layout；如果需要锚点，只使用 canonical source elements。
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
