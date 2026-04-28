# M365 Copilot 变更与进度文档

最后更新：2026-04-28
当前状态：M365 canonical baseline、export adapter baseline 和 JSON export MVP 底层能力已落地，diagnostics 已改为手动 gate
配套上下文：`M365_COPILOT_CONTEXT.md`

后续 Codex 会话开始修改 M365 相关代码前，必须先阅读本文件和 `M365_COPILOT_CONTEXT.md`。任何改变 M365 selectors、canonical model、extractor 输出、export adapter、安全策略、浏览器验证流程或迁移优先级的任务，都必须同时更新这两个文档。

## 文档定位

`M365_COPILOT_CONTEXT.md` 是压缩后的事实入口，供新会话快速判断当前架构和约束。

本文件是更详细的变更记录，记录计划来源、每个阶段完成了什么、为什么这么做、验证结果、仍然不能做什么，以及下一位 Codex 应该从哪里继续。

## 计划来源

本阶段吸收了桌面上的三份历史 plan 以及 2026-04-28 的修复 plan：

- `PLAN.md`：建立 M365 原生 canonical conversation baseline，不复制 Gemini selectors，不让 export / timeline / chatWidth 各自扫描 M365 DOM。
- `PLAN2.md`：收口 canonical baseline、恢复验证环境、修复 Windows checkout/AGENTS 阻塞，并确认 diagnostics 只是临时诊断模块。
- `PLAN3.md`：建立从 `CanonicalConversation` 到现有 export 输入的只读 adapter，不接入 M365 export UI。
- 2026-04-28 修复 plan：把 M365 diagnostics 从默认自动运行改为手动入口，并收紧 `data:image` Markdown 输出安全边界。

这些 plan 的稳定事实已经同步进 `M365_COPILOT_CONTEXT.md`。后续不要重新导入桌面 plan 作为新的事实源；如需查细节，以本文件和上下文文档为准。

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
- `src/pages/content/index.tsx` 已把 M365 与 Gemini 功能隔离：M365 页面只注册 M365 手动 diagnostics 和 chat extractor，然后 return，不启动 Gemini timeline/export/sidebar 等功能。
- `window.__gvExtract()` 保持旧调试输出兼容；`window.__gvExtractCanonical()` 返回 canonical model。
- `window.__gvDiagRun()` / `window.__gvDiagClear()` 仍可用于人工排查，但默认不会自动扫描 DOM、注入 marker、记录 URL/DOM/text 摘要。
- `CanonicalConversation` / `CanonicalMessage` 已成为 M365 extraction 和未来 export/timeline/layout 之间的强制边界。
- `M365ExportService.buildTurns()` 和 `buildExportInput()` 已能从 canonical conversation 生成现有 export service 可消费的 `ChatTurn[]` 和 metadata。
- `M365ExportService.buildJsonExport()` 和 `serializeJsonExport()` 已能生成纯数据 M365 JSON payload/string。
- `window.__gvExportM365Json()` 是仅用于本地验证的 M365 debug/dev 入口，会下载当前页面 JSON 并保存 `window.__gvLastM365JsonExport`。
- Export adapter 仍未接入 M365 UI，不改变 Gemini export 行为。

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

已完成：

- `M365ExportService.buildJsonExport(conversation, title?)` 生成纯 JSON-safe payload。
- `M365ExportService.serializeJsonExport(conversation, title?)` 生成可被 `JSON.parse` 解析的 pretty JSON 字符串。
- JSON payload 顶层包含 `platform: "m365-copilot"`、`title`、`url`、`exportedAt`、`count`、`turns`。
- 每个 JSON turn 只包含 `user`、`assistant`、`starred`、`omitEmptySections`，不包含 `sourceElement`、`contentElement`、`userElement`、`assistantElement` 或 DOM object。
- image-only message 继续以安全 Markdown 图片行进入 JSON，不额外下载图片。
- `window.__gvExportM365Json()` 作为 M365 debug/dev only 入口，可在真机页面下载当前 JSON 并保存 `window.__gvLastM365JsonExport`。

当前限制：

- 仍未添加正式 M365 export UI。
- 暂不做 Markdown、PDF、Image export、timeline 或 chatWidth 接入。
- Debug/dev helper 仅用于本地验证，不作为产品入口。

### 5. Image URL 安全边界

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

## 验证记录

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
