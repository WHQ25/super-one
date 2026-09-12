# 02. 0.153.2 → 0.154.0 协议兼容（双轨）

状态：[PLANNED]

## 目标

同时审查 **稳定 schema** 与 **`experimentalApi` runtime**。保证 SuperOne 手写协议层在 0.154 上不崩，未知 **server request** 有正确 JSON-RPC 错误，rewind 语义不被改错。不把官方生成的全量 TS 当业务类型。

## 双轨结论（`rust-v0.153.2` → `rust-v0.154.0`）

### 稳定导出（过滤 experimental 后的 TS `ClientRequest`）

方法集合 **102 → 102**。唯一稳定方法签名变化：

- `account/rateLimits/read`：params 从 `undefined` 变成可选 `GetAccountRateLimitsParams`（`supportsLunaReserve`、`excludeResetCreditDetails`）。无参调用仍合法。

稳定 `ServerRequest` **10 → 10**。稳定 `ServerNotification` **83 → 83**。**没有**新的稳定 notification method。不要写「若干新通知」。

### Experimental runtime（`initialize.capabilities.experimentalApi: true`，SuperOne 已开启）

Rust `app-server-protocol/src/protocol/common.rs` 新增四个 experimental **ClientRequest**（**client → Codex server**，稳定 TS **看不到**）：

- `userVerification/status`
- `userVerification/enroll`
- `userVerification/delete`
- `userVerification/verify`

本地 build 上 Codex 收到这四个方法会回 unavailable，不是静默成功。

**本轮不发送这四个 RPC，也不为它们增加客户端 responder。** 它们不是 ServerRequest。

`attestation/generate` 是入站 **ServerRequest**（`server_request_definitions!`，`common.rs:1724,1769-1772`），与上述四个出站 verification RPC 不同。opt-in 走独立的 `initialize.capabilities.requestAttestation`（默认 false，`protocol/v1.rs`）。本轮继续省略/关闭 `requestAttestation`，不实现 attestation；若仍收到该未实现请求，返回 JSON-RPC method-not-found（`-32601`），不回空成功。

入站要处理的是 `mcpServer/elicitation/request`。其中 `mode: "openai/userVerification"`（`mcpServer/elicitation/request.userVerification`）要专门 extensions opt-in，**不会**因为 `experimentalApi: true` 自动启用。未 opt-in 时按 elicitation schema **cancel**，不要空 `{}`、不要当未知 method 回 `-32601`（method 是已知的 elicitation）。其它未知入站 method 才回 `-32601`。

## Rewind / fork 参数（不要改名）

`thread/revert`：`{ threadId, beforeTurnId }` — **exclusive**（该 turn 及之后都丢掉）。

`thread/fork`：稳定字段是 `{ threadId, lastTurnId? }` — **inclusive**。`experimentalApi` 下 fork **同时**接受 `beforeTurnId`（exclusive）。两者 0.153.2 已有。

[`CodexBackend.rewindConversation`](../../../../apps/desktop/src/main/session/backends/codex-backend.ts) 先 `thread/revert { beforeTurnId }`，paginated 失败再 `thread/fork { beforeTurnId }`。SuperOne 已开 `experimentalApi`，fork 的 exclusive 截断与 revert 对齐。**这不是 bug。**

禁止把同一个 turn id 从 `beforeTurnId` 改成 `lastTurnId`：inclusive 会把边界 turn 留在历史里。

本轮补 **语义 fixture**：给定 turns `[t1, t2, t3]`，rewind before `t2` 后历史不得包含 `t2`/`t3`。只断言 JSON 键名不够。

共享 [`fork-thread.ts`](../../../../packages/codex/src/fork-thread.ts) 的 `lastTurnId` 路径用于 session fork（inclusive 锚点），与 rewind 分开，不要合成一套参数。

`thread/rollback` 在 0.154.0 仍注册。`origin/main` `#44915` 才删，不承诺尚未发布的 0.155。legacy fallback 先留着。

## 未知流量

| 方向 | 策略 |
|---|---|
| 未知 **notification**（无 id） | debug 日志后丢弃，不断开连接 |
| 未知 **server request**（有 method + id） | 必须回 **同一 id** 的 JSON-RPC `-32601`（method not found） |
| 已知 approval / elicitation | 按其专有 schema `deny` / `cancel`，不是泛化 `{ decision: 'deny' }` 也不是 `{}` |

现状不合格，不能称为「通用兼容」：

- desktop [`codex-turn.ts`](../../../../apps/desktop/src/main/codex/codex-turn.ts) 对未解析的 server request `respond(..., {})`（空对象，像成功）。
- shared [`app-server-client.ts`](../../../../packages/codex/src/app-server-client.ts) 对所有 inbound request 回泛化 deny。

本轮把这两处改掉。未 opt-in 的 `openai/userVerification` elicitation：按 elicitation schema **cancel**。不要为空成功，不要给 `userVerification/*` 写出站以外的 inbound handler。

## Parser

- 业务类型继续手写窄解析：`protocol-v149.ts` / `protocol-v153.ts` 风格。0.154 必须解析的新字段（如 `toolsError`，见 [04](./04-live-refresh.md)）放 `protocol-v154.ts` 再导出。
- Thread 响应的 `environments`、`originator` 本轮 parse-and-ignore，见 [05](./05-thread-lifecycle.md)。
- 单测用 0.154 形状的 fixture（多出来的字段）喂现有 mapper，断言不抛、旧字段仍在。
- `send_message_to_user_async`：`delivery = async` 且 `questions = null` 是 attention-only，**不结束 turn**。补 fixture，避免当成 final answer。payload 仍是 `AsyncUserInputQuestion`；TUI inline Other 不需要 SuperOne UI。

## 路径 / Guardian（回归，不改产品）

- `cwd` / applyPatch files 在协议里是 `LegacyAppPathString`，wire 仍是 string。Windows 与 remote 用 **target-native** 路径 fixture，不要按 Electron host 路径正规化。
- `strictReviewRequired` 现按 `review_reason` 触发。回归 allow / deny / failure。
- Detached review 会发 `deprecationNotice`；SuperOne 已走 inline review，不阻断升级。

## 验收

- `packages/codex` 与 desktop Codex 相关 `--changed` 测试通过。
- rewind fixture：边界 turn 被排除；JSON 仍发 `beforeTurnId`。
- 未知 server request 回 `-32601` + 同一 id；未知 notification 不拆连接。
- 带 `environments` 的 `thread/start` / `thread/fork` 能走完 ensure-thread。
- async + `questions: null` 不触发 turn complete。
