# Voyager V2 安全说明

- 导入文件限制大小，并校验结构、层级、ID 引用和 URL 协议。
- 用户文本通过 `textContent` 或 React 文本节点渲染；不执行导入的 HTML。
- 会话链接只允许 HTTP、HTTPS 或站内绝对路径。
- 云端只同步文件夹、提示词与星标，不上传会话正文和导出内容。
- OneDrive 使用 OAuth 授权码 + PKCE 和 `Files.ReadWrite.AppFolder`；不包含客户端密钥，不请求或持久化刷新令牌。
- Access token 只保存在 `storage.session`；不支持该 API 时只保存在扩展当前内存。
- Graph host 权限仅在用户启用 OneDrive 时请求。
