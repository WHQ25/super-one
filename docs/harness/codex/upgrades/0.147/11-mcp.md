# 11. MCP 状态、资源、工具和 OAuth

状态：[PARTIAL]

已实现：本地 Codex MCP 页面读取 `mcpServerStatus/list(detail: full)`，展示连接/auth/tools/resources；Main 提供资源读取和工具调用 IPC，OAuth 复用既有 `mcpServer/oauth/login` 流程。

## 目标

把 `mcpServerStatus/list`、`mcpServer/resource/read`、`mcpServer/tool/call`、`mcpServer/oauth/login` 和 `config/mcpServer/reload` 与 SuperOne 的 MCP 设置和权限链对齐。

## 实现设计

- MCP server status 作为运行时快照：startup、tools、resources、auth，不与静态 config 混为一体。
- `detail: toolsAndAuthOnly` 用于列表，`full` 只在详情页打开时请求。
- OAuth URL 只在 Main 处理并通过一次性 IPC 返回 renderer；完成通知按 server name + environment 路由。
- MCP reload 后等待 `mcpServer/startupStatus/updated`，再刷新工具列表。
- `mcpServer/tool/call` 只能调用当前环境已配置且允许的 server/tool。

协议注意：0.147 的参数名是 `server`/`tool`，工具调用必须带 `threadId`；`mcpServerStatus/list` 不支持按 serverName 请求，Main 会在完整快照返回后过滤。远程项目的状态、资源和工具调用目前 fail closed，避免把 `remote:*` key 误交给本地 App Server。

## UI/UX

- Settings → MCP 行显示 Connected、Starting、Auth required、Error 四种状态。
- Auth required 行提供 Connect；OAuth 完成后自动刷新，不要求重启。
- tools/resources 使用可折叠详情；显示 server、tool name、风险级别和最近错误。
- reload/重连显示行内进度；失败保留上次可读状态并标记 stale。

## 安全与测试

- OAuth URL、refresh token 和 headers 不进入 renderer 持久化。
- 远程环境的 MCP 状态必须从远端返回，不使用本地缓存冒充已连接。
- OAuth 成功、取消、超时、失败均有终态测试。
- reload 后工具最终一致，旧工具不会继续出现在 picker。

当前限制：尚未接入 `mcpServer/startupStatus/updated` 事件和远程节点 MCP 路由；状态请求失败时 UI 保留 pending/stale，而不是伪装 connected。
