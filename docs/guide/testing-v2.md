# V2 测试与发布门禁

提交前运行：

```powershell
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:coverage
npm.cmd run build:chrome
npm.cmd run build:edge
npm.cmd run build:firefox
npm.cmd run docs:build
npm.cmd audit --omit=dev
git diff --check
```

真实浏览器验收覆盖 Chrome、Edge 与 Firefox：新聊天、长对话、虚拟列表恢复、VoyagerDock、Popup、文件夹、提示词插入、选择导出、引用复制，以及双云登录、冲突和切换。测试不会自动发送 M365 消息。

OneDrive 客户端 ID 与已登录 M365/云账号属于外部验收条件，不应写入仓库。
