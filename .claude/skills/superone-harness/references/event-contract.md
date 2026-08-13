# The AgentEvent Contract

`AgentEvent` (`packages/shared/src/agent-types.ts`, ~90 variants) is the **only** thing a harness
backend has to speak. Everything downstream — chat rendering, the store, SQLite persistence, mobile,
remote nodes — consumes this union and nothing else.

That is the leverage in the whole architecture: **you do not write UI to light up a feature. You emit
the event and the existing UI appears.** When a feature is missing for your harness, the first
question is always "which event am I not emitting?", not "which component do I need to fork?".

The event reducer that consumes these lives in `apps/desktop/src/renderer/src/stores/chat-store/event-reducer/`,
split by concern (`content.ts`, `tool.ts`, `permission.ts`, `todos.ts`, `usage.ts`, …). Reading the
reducer file for a feature is the fastest way to learn exactly what shape it expects.

## Contents

- [Minimum viable turn](#minimum)
- [What each event unlocks](#unlocks)
- [Streaming rules](#streaming)
- [Session lifecycle & idle](#lifecycle)
- [Gotchas](#gotchas)

---

<a id="minimum"></a>
## Minimum viable turn

Emit these, in this order, and you have a working chat. Nothing else is required for P1.

```
session_init          { session }                     once per backend start
message_start         { message }                     one assistant message shell
content_delta         { messageId, delta }            repeated — text / thinking / tool_use / tool_result
message_complete      { messageId, metadata? }        turn done; triggers persistence
```

Failure and cancellation are part of the minimum, not polish — the store leaves the session
permanently "streaming" without them:

```
message_error         { messageId, error }
message_interrupted   { messageId, metadata? }
status_change         { status }
```

`content_delta.delta` is a `ContentBlock`. The four that matter first: `text`, `thinking`,
`tool_use`, `tool_result`.

---

<a id="unlocks"></a>
## What each event unlocks

| Emit… | …and you get |
|---|---|
| `tool_input_delta` | live streaming of tool arguments as the model types them (`supportsStreamingToolInput`) |
| `tool_progress` | elapsed-time spinner on long tool rows |
| `permission_request` | the permission popover + approve/deny round trip |
| `ask_user_question` | the question card |
| `plan_approval` | the plan approval prompt |
| `todos_updated` | the TODO panel (`supportsTodos`) |
| `task_started` + `parentToolUseId` on blocks | nested subagent rendering (`supportsSubagents`) |
| `message_usage` | per-turn tokens/cost + the context gauge |
| `rate_limit` | the account usage warning |
| `compact_boundary` / `status_indicator` | compaction UI (`supportsCompact`) |
| `init_ready` | skills, project commands, agents, additional dirs, sandbox + permission state |
| `provider_session_id` | resume after restart — **persist this or cold resume breaks** |
| `session_title_changed` | sidebar title sync |
| `checkpoint_captured` | rewind points |
| `agent_setting_change` / `permission_mode_change` | UI reflects a change the *provider* made |
| `queued_message_consumed` | the queued-message chip clears |
| `api_retry` / `model_fallback` | retry + fallback notices |
| `hook_started` / `hook_complete` / `hook_progress` | hook rows |
| `slash_command_output` | slash command result bubble |
| `worktree_missing` | the worktree recovery banner |

Harness-prefixed variants (`codex_*`) are escape hatches for a genuinely different data model. Prefer
a generic event; reach for a prefixed one only when the shared shape would lose information. Every
prefixed event costs a branch in the reducer, the mobile stripper, and the persistence layer.

---

<a id="streaming"></a>
## Streaming rules

- **Batch, don't flood.** Use `packages/shared/src/agent-event-batcher.ts` and the shared
  `applyContentDelta` from `@superone/shared/content-delta` — one implementation, no per-harness copy.
- **Only merge deltas with the same `parentToolUseId`.** Merging across parents corrupts subagent
  nesting. This has been a real bug.
- **Never throttle with `requestAnimationFrame`.** Under render pressure rAF starves and the stream
  visually freezes; use `setTimeout`.
- **Tool input merging is sparse-safe.** `mergeToolUseInputJson` keeps earlier summary fields
  (`query`, `command`, `file_path`, …) when a later partial update omits them — that's what makes
  ACP's sparse updates not blank the tool row. Send partial updates freely; don't hand-merge.
- **`stream_message_start` / `stream_message_stop`** delimit provider-level messages inside one
  SuperOne message. Emit them if the provider has that nesting; skip them otherwise.

---

<a id="lifecycle"></a>
## Session lifecycle & idle

- Backends get `start` / `rebuild` / `prewarm` / `close`. `rebuild` fires when something
  unchangeable-in-place changed (cwd, permission-mode boundary, additional dirs). If your provider can
  apply a change in place, do it in the setter and don't force a rebuild — rebuilds lose warm state.
- **Do not rely on a provider "idle" signal existing.** The Claude SDK never emits
  `session_state_changed`; idle is derived from `task_started` / task updates. Derive idle from turn
  boundaries you actually observe.
- `getPendingInteractions()` must replay unanswered permission/question/plan requests, or resuming a
  session drops a prompt the user was mid-way through answering.
- `injectTaskNotification()` is a **mid-turn** hook only. Return `false` when idle and let `Session`
  start a proper turn — calling `backend.send()` from it races the session state machine.

---

<a id="gotchas"></a>
## Gotchas

- **Persist `provider_session_id`.** It's how cold resume finds the provider-side thread. It flows
  `onProviderSessionId` → `SessionStateChange.providerSessionId` → DB → `SessionCreateOptions.providerSessionId`.
- **Mobile strips events.** Tool input is dropped and results truncated to ~200 chars. A harness with
  rich tool payloads needs an explicit exemption, or the mobile view silently degrades.
- **`isReplay` / `isSynthetic` on `content_delta`** mark events that must not re-trigger side effects
  (persistence, notifications). Set them when replaying.
- **Event ordering is a contract.** `message_start` before any `content_delta` for that id;
  `message_complete` last. The reducer tolerates some slop but persistence and the mobile broadcaster
  assume the happy order.
- **Trace before guessing.** `trace('agent.emit', type, event, messageId)` from the main process and
  `window.app.trace?.(...)` from the renderer write to the dev SQLite event trace — the fastest way to
  see where an event stopped flowing. Keep those calls DEV-gated: `?.` does not short-circuit argument
  evaluation, so an expensive expression in the arg list still runs in production.
