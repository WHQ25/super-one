# 05. Thread 生命周期：environments 容忍，不改权限 inherit

状态：[PLANNED]（范围收窄）

## 目标

对齐 0.154 thread 响应里的 `environments` 快照，保证 parser / ensure-thread 不崩。

**本轮不做权限 inherit，也不按 changelog 省略 resume/fork 上的显式权限。**

## 不要根据 TUI release note 改 SuperOne 权限

官方 #43330 / #43177 / #43355 写的是 TUI remote client：resume/fork 保留已保存 permissions、fresh/fork 未覆盖时用 server 模型默认。这些 **不是** 新的 app-server 规则。

App-server 在 0.153.2 已经会恢复 saved `approvalPolicy` / reviewer / profile（`thread_processor.rs`）。SuperOne 若在 resume 后第一次 `turn/start` 仍带当前 UI 的 `approvalPolicy`、`approvalsReviewer`、sandbox + roots，**立刻覆盖**刚恢复的值。相关发送点：

- desktop [`codex-turn.ts`](../../../../apps/desktop/src/main/codex/codex-turn.ts) sandbox / approval / turn start / settings update
- shared [`app-server-client.ts`](../../../../packages/codex/src/app-server-client.ts) thread/turn 参数

因此：

- 删除「0.154 才有 saved permissions / 0.153 必须版本分支」。
- 删除「本轮 resume 无条件省略权限字段」。
- 本轮 **继续显式发送 SuperOne 当前权限**，行为与 0.153 一致，避免静默改审批。

若以后要做 inherit，必须单独设计，覆盖：选择来源、恢复 effective `approvalPolicy` / `approvalsReviewer` / permission profile / sandbox+roots、回写 UI，以及 `turn/start`、`thread/settings/update`、compact、review、CLI 全路径。不塞进这次 pin。

模型：明确的 SuperOne 用户选择继续显式传。无明确选择时保留服务端默认解析（省略 `model` 并采用响应，或先 `config/read`、为空才用 list default）。effort / serviceTier 同步尊重同一选择来源。省略 `model` 是合法的现有 app-server 行为，见 [03](./03-models-astra.md)。response adoption 要把 **effort / serviceTier** 一起接上，不能只读 `model`。

Fork：SuperOne git worktree fork 继续用自己的 `cwd` / `worktreePath`。`fork-thread.ts` 的 `lastTurnId` 是 inclusive session fork，与 rewind 的 exclusive `beforeTurnId` 分开（见 [02](./02-protocol-compat.md)）。

## `environments`

0.154 在 thread 响应里暴露 loaded environments（experimental snapshot，`thread_data.rs`）：

- `{ environmentId, cwd, runtimeWorkspaceRoots }`
- `null`：未加载或未暴露（从存储读时是 `None`，不表示连接状态）
- `[]`：已加载但无选择

不持久化，不改变 executor / resume。本轮 **parse-and-ignore**，或只在 diagnostics 展示 cwd。不要用它替代 SuperOne EnvironmentGateway。

`originator`：分析用。`thread/list` 带非空 originators 过滤时，**本地** app-server 会拒绝；不要把「扩展过滤」理解成本地可用。UI 不展示。

## 验收

- 带 `environments: null` / `[]` / 有条目的 start/resume/fork 响应不拆会话。
- 升级后 resume 的权限与 0.153 SuperOne 行为一致（仍发送当前 UI 权限），没有新的「继承」语义。
- 用户选中的 model/effort/tier 在 turn 上仍然显式存在；无明确选择时省略 `model`，不拿 list picker default 覆盖 `config.model`。
- originators 过滤不接到本地 `thread/list`。
