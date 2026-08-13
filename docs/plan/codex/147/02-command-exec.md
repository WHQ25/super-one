# 02. 独立命令与 PTY 执行

状态：[PLANNED]

## 目标

使用 `command/exec` 在不创建 Codex turn 的情况下执行一次命令；支持 buffered 命令、PTY、stdin、resize、实时 stdout/stderr、terminate。用于终端、测试、构建和诊断，不把每次 UI 操作污染到对话历史。

## 协议设计

请求：`command/exec`，参数包括 `command: string[]`、`cwd`、`sandboxPolicy`、`timeoutMs`、可选 `tty`、`streamStdoutStderr`、`processId`。

后续请求：`command/exec/write`、`command/exec/resize`、`command/exec/terminate`。流式通知：`command/exec/outputDelta`。最终响应只有进程退出且输出通知已发出后返回。

## 代码边界

- `packages/codex`：平台无关的 `CodexExecHandle`、base64 解码、退出状态和超时模型。
- `apps/desktop/src/main/codex`：连接复用、权限请求、日志和 IPC adapter。
- `apps/desktop/src/main/terminal`：复用终端快照/PTY 展示，但不要重复实现进程管理。
- `packages/shared/agent-types.ts`：新增 IPC-safe `CodexExecRequest/Result/Output`。

## UI/UX

- 终端面板顶部提供“Codex Sandbox 命令”入口，与普通本机终端用不同徽标区分。
- 命令启动前显示 cwd、sandbox mode、network 状态；需要批准时使用现有 PermissionPrompt。
- 输出使用 xterm，底部显示运行中/退出码/耗时；提供 Stop、重新运行、复制输出。
- 非 PTY 命令显示简洁的 stdout/stderr 折叠区；空输出显示退出码而不是空白面板。
- 断线时保留“连接丢失，命令状态未知”，禁止 UI 擅自显示成功。

## 安全

- 默认继承当前会话 sandbox policy，不允许 UI 默认升级到 `dangerFullAccess`。
- `command` 必须是 argv 数组；不要为此功能拼接 shell 字符串。
- cwd 必须落在当前 project/environment scope；远程节点由节点侧再次校验。
- 终止和重试使用 process id 映射，防止旧命令的 late event 更新新面板。

## 验收

- buffered 命令正确返回 stdout/stderr/exitCode。
- PTY 支持输入、resize、Ctrl-C/terminate、实时输出和非 ASCII 文本。
- 命令权限拒绝、超时、连接关闭、旧 runtime 不支持均有明确结果。
- 同一连接上并行命令的 output 不串线。
