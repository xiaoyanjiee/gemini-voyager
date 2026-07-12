# Voyager V2 架构

Voyager V2 以 M365 Copilot 为主要平台，并保留 Gemini 与 AI Studio 的兼容入口。Chrome、Edge 和 Firefox 是正式支持的浏览器。

## 运行边界

- 每个平台拥有独立 content script。M365 不加载 Gemini 的功能和通用样式。
- `PlatformAdapter` 负责站点识别，`FeatureModule` 负责启动与完整清理。
- M365 初始模块按需加载；诊断工具只存在于开发构建。

## 数据边界

- `gvSettingsV2` 位于同步存储，只保存小型设置。
- `gvWorkspaceV2` 位于本地存储，保存文件夹、会话引用、提示词、星标和删除 tombstone。
- V2 不读取或删除旧 key，便于回退旧版本。
- storage、导入文件、OAuth 响应和云文件均通过 Zod 校验。

## M365 会话

`ConversationSnapshot` 只含可序列化数据。文本、列表、代码、表格、链接与图片由 `MessageBlock` 表达。实时 DOM 节点保存在 `ConversationDomIndex`，不会进入存储或 JSON。`ConversationSession` 合并虚拟列表中已经出现的消息，并自动清理失效锚点。

## UI

M365 Popup 使用独立的 Fluent 风格控制中心。页面内 `VoyagerDock` 通过 Shadow DOM 隔离样式，统一提供时间轴、文件夹、提示词、消息操作与导出入口。
