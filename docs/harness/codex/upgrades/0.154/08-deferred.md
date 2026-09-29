# 08. 其余暂缓项

状态：[DEFERRED]（Windows sandbox smoke 除外，见下）

0.154 changelog 里还有一批变化，明确不进本轮产品化。记录在这里避免后续升级漏看。

## Windows app-server daemon — 暂缓；stdio 与 sandbox 不暂缓

`#42405` / `#42392`：Windows 会话共享后台 Codex server。

**延期依据不是「SuperOne 连接池 ≈ daemon」。** Codex CLI 仍独立支持直接 `app-server` / stdin（`cli/src/main.rs`）。SuperOne 按项目预热连接、metadata idle 与 take 独占，和 daemon 不是同一生命周期。desktop metadata idle 是 5 分钟量级，不要写 60s 共享 daemon。

本轮继续走 **直接 stdio app-server**。不嵌 Codex daemon。

**不随 daemon 延期：** Windows `windowsSandbox/setupStart`、`readiness`、以及该平台上第一条 command 的 smoke。升级后要跑。

## Realtime “always available”

`#42377` 去掉 realtime gate，**不改 wire**。现有 `codex-realtime.ts` start/stop smoke 足够，不改产品。WebRTC / voice-host 大块仍实验。

## Async questions / attention-only

TUI inline Other（#42891 等）不需要 SuperOne 1:1 抄。`AsyncUserInputQuestion` 未变。

**要测、不算 TUI 复刻：** `send_message_to_user_async` 在 `delivery=async` 且 `questions=null` 时是 attention-only，FinalAnswer phase **不结束 turn**。fixture 放在 [02](./02-protocol-compat.md)。

## User-verification ceremony — 暂缓

Experimental client methods（稳定 `ClientRequest` 不含）：

- `userVerification/status`
- `userVerification/enroll`
- `userVerification/delete`
- `userVerification/verify`

这四个是 **client → server** 的 ClientRequest，不是入站 ServerRequest。本地 build 上 Codex 对它们回 unavailable。elicitation `openai/userVerification` 要专门 extensions opt-in，**不能**靠 `experimentalApi: true` 打开。

本轮 **不发送** 这四个 RPC，也不为它们加客户端 responder。入站 elicitation：unsupported `openai/userVerification` mode 按 elicitation schema **cancel**。`attestation/generate` 是入站 ServerRequest，靠 `initialize.capabilities.requestAttestation`（默认 false）opt-in；本轮关闭该 capability，若仍收到则 `-32601`，不回空成功。未知入站 method 同样 `-32601`。不做 enroll/verify/attestation UI。

## Experimental context management — 暂缓

`#42385` / `#43147`。不要在 Settings 暴露开关。

`experimentalFeature/enablement/set` 是 **mutation**，不是 read。config processor allowlist **不含** `context_management`。不能假设任意 feature 都能用该 RPC 切换。内部 diagnostics 若列出 features，用 `experimentalFeature/list`，不要对 context 发 set。

## TUI-only

Vim replace mode、`/copy`、Astra sparkle、agent command center、collaboration mode 发现。SuperOne 不是 Codex TUI。

## 已删除的 `codex mcp-server`

#42993。SuperOne 不调用。升级 checklist grep 一次即可。

## 留给 0.155+

`thread/rollback` 在 0.154.0 仍在；`origin/main` 后续 commit 才删。`fork-thread.ts` 的 rollback fallback 先留着。
