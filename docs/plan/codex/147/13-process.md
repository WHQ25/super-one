# 13. Process API 评估

状态：[DEFERRED]

## 范围

评估 `process/spawn`、`process/writeStdin`、`process/resizePty`、`process/kill`、`process/outputDelta` 和 `process/exited`，不代表当前实现。

## 暂缓原因

- API 运行在 Codex sandbox 之外，会绕过现有 permission/sandbox 审批链。
- 与 SuperOne TerminalManager、remote process ownership、设备断线恢复重复。
- renderer 或 dynamic tool 误用时影响面大于 `command/exec`。

## 未来前置条件

- 单独的 privileged process capability 和环境级 allowlist。
- 进程 owner、审计日志、断线后的 kill/reconcile 策略。
- 明确区分 sandbox 内 `command/exec` 与 sandbox 外 process UI。

## UI/UX 与验收门槛

如果未来实施，必须使用红色“外部进程”徽标、创建前二次确认、实时 owner/权限信息和强制终止按钮；不能隐藏在普通终端命令菜单中。安全审计通过后才允许 beta 开关；异常、断线、重复 kill、PTY resize 和权限拒绝都必须有集成测试。
