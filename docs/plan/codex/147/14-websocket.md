# 14. WebSocket App Server 评估

状态：[DEFERRED]

## 范围

评估 `codex app-server --listen ws://...`、capability token、signed bearer token、反压和远程连接行为。官方目前仍标注 experimental/unsupported for production。

## 不替代现有远程节点

SuperOne 已有 Remote Node authenticated RPC、Environment Gateway 和 connection supervisor。为了“远程 Codex”再引入第二套节点协议，会重复认证、权限、断线恢复、节点版本和审计模型。

## 重新评估条件

1. 官方将 transport 标记为 stable，并提供版本兼容策略。
2. 能力、认证、反压、断线恢复与 Environment Gateway 明确对齐。
3. 通过真实多客户端、长 turn、权限请求和安全审计验证。

## UI/UX 方向

未来若采用，连接设置必须显示 endpoint、认证方式、TLS、环境身份和 runtime version；首次连接需明确 token 来源和信任范围。非 loopback listener 禁止无认证保存。

## 当前替代方案

- 本地/节点 Codex turn：复用 `@superone/codex` 核心。
- 本地命令：`command/exec`。
- 远程执行：SuperOne Remote Node authenticated RPC。
