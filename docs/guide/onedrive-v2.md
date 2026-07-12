# 配置 OneDrive V2

OneDrive 未配置 Entra 客户端 ID 时会保持禁用，不影响本地功能、Google Drive 或构建。

## Entra 注册

1. 在 Microsoft Entra 管理中心创建“单页应用程序”注册。
2. 记录 Application (client) ID，并在构建环境设置 `VITE_ONEDRIVE_CLIENT_ID`。
3. 添加 Microsoft Graph 委托权限 `Files.ReadWrite.AppFolder`，不要添加更宽的 Files 权限。
4. 不创建客户端密钥。

## 重定向 URI

运行扩展后，在对应浏览器控制台执行 `chrome.identity.getRedirectURL('onedrive')`，将返回值加入 Entra 的 SPA 重定向 URI。Chrome、Edge、Firefox 的扩展 ID 不同时，需要分别登记。开发版与商店版 ID 不同也需要分别登记。

## 同步行为

用户每次切换主云都必须选择：

- 合并远端：按记录 `updatedAt` 合并；同时间戳下 tombstone 优先。
- 用本地覆盖：用当前 V2 文件夹、提示词与星标覆盖远端 V2 文件。
- 用远端替换：只替换本地对应三类记录，保留本地会话引用。

OneDrive 文件写入 `/me/drive/special/approot`，文件名为 `voyager-workspace-v2.json`。旧云文件不会读取或删除。
