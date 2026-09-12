# 04. 热刷新回归 + MCP 诊断 / OAuth

状态：热刷新 [VERIFY]；`toolsError` 与 OAuth `_meta` [PLANNED]

## A. 插件 / Skills / Hooks 热刷新 — [VERIFY]

0.154 修了外部安装/升级/回滚后 live thread 看不到新工具 / skills / hooks 的问题（#42284、#42593、#42990）。SuperOne 在 0.153 已有 `plugin/reconcile` + `app/installed` + `config/mcpServer/reload`。本段只做回归，不重做 marketplace。

### 当前能力

- [`CodexBackend.reloadPlugins`](../../../../apps/desktop/src/main/session/backends/codex-backend.ts) 调 `plugin/reconcile`，按 `hasApps` / `hasMcps` / `hasSkills` 分别刷新。
- `app/installed` + `forceRefresh: true` 针对 live thread Apps（Codex `apps_processor/installed.rs`）。
- Skills watcher 与 `notifyCodexSkillsChanged` 已存在。

### 不要写错的两点

- **不是所有 reload 都有 busy guard。** `reloadMcpServers` 在 turn 进行中会跳过（`codex-backend.ts`）；`reloadPlugins` 里的 `config/mcpServer/reload` **没有**同样的 guard。
- **不要假设 server reload 必然立刻掐断 in-flight 工具。** Codex MCP runtime 会保留旧 binding 的连接，再按 thread refresh。先覆盖在途调用回归，再决定要不要给 `reloadPlugins` 加队列 / guard。

### 升级后要验证

1. 进程外改 `CODEX_HOME` 插件目录后，`reloadPlugins` 或 0.154 自动 refresh 让下一 turn 看到新 tool；若有 notification，dispatcher 接到并刷新 UI。
2. `app/installed` 对 live thread 仍有效。
3. hooks/list 与实际 handler 一致。
4. 正在跑的 SuperOne MCP 工具：reload 期间不丢结果（实测，不预判）。

## B. MCP `toolsError` 诊断 — [PLANNED]

0.154 `McpServerStatus.toolsError`（`v2/mcp.rs`）：discovery 失败且没有 catalog 时有值；成功返回 catalog（包括空 catalog）时为 null。

[`mapCodexMcpStatusForIpc`](../../../../apps/desktop/src/main/codex/codex-mcp-status.ts) 只按 `serverInfo` 判断 `connected`，完全忽略 `toolsError`。结果：工具发现失败仍显示成正常空目录。

`runtimeStatus` / 连接状态与 `toolsError` 在 0.154 是 **独立字段**（`v2/mcp.rs`）。目录发现失败 ≠ 断开连接。有 `runtimeStatus: connected` + `toolsError` 时必须保留 connected，另外暴露目录不可用。

本轮：

- 解析并下发 `toolsError`；保留独立的 connection / `runtimeStatus`。
- UI 不把「已连接 + toolsError」画成纯健康，也不画成 disconnected/failed。错误可见，且不得当成正常空 catalog。
- 单测：`serverInfo` + `runtimeStatus: connected` + `toolsError` → 连接仍是 connected，且错误可见、toolCount 不伪装成健康的 0 tools。

## C. MCP OAuth challenge 桥接 — [PLANNED]

0.154 可以协调 OAuth token refresh，失败时在 **tool result `_meta["mcp/www_authenticate"]`** 放 401 challenge，并且 **失败不重放**。这是 **auth-rejected**，不是用户点了拒绝。

默认 **legacy** 路径；**coordinated** 是显式 feature（Codex `features` 里 coordination 默认 false）。两种都要测。

现状：desktop [`codex-turn.ts`](../../../../apps/desktop/src/main/codex/codex-turn.ts) 与 [`packages/codex/src/agent-event-mapper.ts`](../../../../packages/codex/src/agent-event-mapper.ts) **丢弃 `_meta`**。调用已有 `mcpServer/oauth/login` **不会**自动把失败 tool result 变成可点登录入口。

本轮：

1. 保留 tool result `_meta`，把 `mcp/www_authenticate` 映射成可点的登录动作（走现有 `mcpServer/oauth/login`）。
2. 区分三条路径：用户 deny、auth-rejected challenge、普通 tool error。
3. 用户拒绝过的 tool call 不得 replay（Codex 已保证；SuperOne 不要自己重试）。
4. 测试矩阵：legacy refresh 失败、coordinated refresh 失败、用户 deny。不把「用户拒绝」写成 OAuth 文案。

## 不做

- 不重做 marketplace UI。
- 不把 `plugin/share/*` 产品化。
- 不把 Apps/Connectors 从 [12-apps](../147/12-apps.md) 拉进本轮。
- 不把 user-verification elicitation ceremony 塞进 OAuth 项（见 [08](./08-deferred.md)）。

## 验收

- VERIFY：安装/卸载插件后下一 turn 工具 / skills / hooks 同步；现有 plugin reconcile 测试仍绿。
- PLANNED：`toolsError` 与空 catalog 在 UI/IPC 上可区分；有 `toolsError` 时不伪造 disconnected，也不显示纯健康。
- PLANNED：auth challenge 能打开登录；deny 与 auth-rejected 文案不同；被拒 tool 不 replay。
