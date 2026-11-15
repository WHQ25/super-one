# Codex prompt prediction

Verified on 2026-10-17 against npm Codex 0.163.0, upstream main
`96eb400d1231f0199e96f640c740096087cf3e9b`, and the locally installed official
app. Rechecked on 2026-10-29 against pinned npm Codex 0.165.0:
`thread/prediction/request` still returns `-32601` on the releases checked
through 0.169.0. SuperOne now generates the suggestion with `thread/sample`
on the pinned 0.169.0 server. See the current status below. The rest of this
note records the October 2026 investigation.

## Two different interfaces

| Interface | Actual behavior |
|---|---|
| `thread/prediction/request` | Declared experimental, but the 0.163.0 and inspected main handlers unconditionally return method-not-found / not implemented. Enabling experimental API does not implement it. `rust-v0.165.0` `message_processor.rs` still returns `thread/prediction/request is not implemented yet`. |
| `thread/prediction/updated` | Declared notification; no native generator emits it in the inspected release or in `rust-v0.165.0`. SuperOne already receives it if a future server supplies it. |
| `thread/sample` | Experimental one-shot fork response added in 0.164.0, with `thread/sample/cancel`. SuperOne calls it for prompt suggestions only. |
| `thread/fork` with `experimentalPredictionMode: true` | Implemented. Creates an ephemeral fork from a loaded, persisted parent, inheriting effective settings, history, tools and environments for cache reuse. The client then runs a normal `turn/start` to generate a suggestion. |

The unavailable dedicated RPC does **not** mean prompt prediction is impossible
through App Server. The official app implements orchestration in its client.

Primary source:

- [0.163.0 request handler](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server/src/message_processor.rs#L1450)
- [Prediction-fork protocol](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L548)
- [Fork implementation](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server/src/request_processors/thread_processor.rs#L5109)
- [Inherited-context test](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server/tests/suite/v2/thread_fork.rs#L2780)
- [Prediction-fork compaction tests](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server/tests/suite/v2/compaction.rs#L68)

## Official app implementation observed locally

The installed `/Applications/ChatGPT.app` has bundle ID `com.openai.codex`,
version `26.1007.71326`, build `20398`. Its packaged Codex version is
`0.162.0-alpha.17.2`; its feature check explicitly permits prediction forks for
that build, or versions at least `0.162.0-alpha.20`.

Read-only inspection of `Contents/Resources/app.asar` found:

- `.vite/build/main-CwxgTOle.js`: `hge`, the prediction generator; `_ge`,
  the controller; `vge.requestUserMessagePrediction`, the exposed service.
- `.vite/build/src-DCNiwad_.js`: `Rq`, the temporary generation helper;
  `kn`, the ordinary turn runner; `forkThread`, the JSON-RPC wrapper.
- `.vite/build/src-CP7XXlpZ.js`: the feature-version check and local
  `composer-predictions-enabled` setting, defaulting to true.

Observed flow:

1. Read authenticated remote configuration from `/wham/predictions/config`.
   It supplies enablement, sampling rates, unsupported models, the prediction
   prompt/version and reasoning effort. This is configuration, not the
   inference request itself. No request to that private endpoint was made
   during this investigation.
2. Resume the parent thread; skip plan mode, unsupported providers and models.
3. Call `thread/fork` with the parent ID, `experimentalPredictionMode: true`,
   `ephemeral: true`, `excludeTurns: true`, and source `composer_predictions`.
   Do not fall back to an unrelated fresh thread if this fork fails.
4. Call normal `turn/start` on the fork with the prediction prompt. The app
   requests JSON containing a nullable `suggestion` and parses the result
   client-side. It does not call `thread/prediction/request`.
5. Read ordinary agent-message and turn-completed notifications, then
   unsubscribe the temporary thread. Abort/timeout interrupts its active turn.
6. Cache by host, parent thread and source turn. A new parent turn invalidates
   the cached/in-flight result. The returned suggestion records its source
   turn so stale predictions cannot replace newer input.

This establishes the implementation of the installed build; it is not a
claim that every newer app build follows exactly the same path.

A later installed build (26.1029.61003, bundled Codex 0.166.0-alpha.6) prefers
`thread/sample` when the server is at least 0.164.0-alpha.11. The fork path
remains its fallback. SuperOne follows the sample path only.

## Current status (2026-11-15)

After a successful root turn, desktop and the remote node call experimental
`thread/sample`. The prompt is SuperOne-owned and asks for JSON
`{ "suggestion": string | null }`. A parsed string or an explicit null becomes
the existing `prompt_suggestion` event. Unreadable text does not replace a
suggestion already shown. `thread/sample/cancel` runs when the user sends
again, the thread is compacted, or the connection is disposed, and when the
30 second sample timeout fires. A `thread/goal/get` refresh is not one of
those; the composer asks for the goal on every status change, including when
the thread has no goal. Plan mode, custom base URLs, child threads,
and ephemeral threads are not sampled. `allowInProgressTurn` is not sent.
The sample sends `effort: low` so it does not inherit a parent turn at max.
The server applies that only when the model can change effort without
dropping the prompt cache.
Opening an idle thread whose latest turn already finished also samples that
turn once (`prediction_trigger: catch_up`). The desktop composer calls
`session.catchUpPrompt` beside the goal refresh, and only while the session
is idle. The remote node serves the same read. A turn this process is already
sampling, a turn still running, plan mode, and a custom provider are left
alone. `thread/turns/list` supplies the newest turn; only `status: completed`
is sampled.
The `thread/prediction/updated` receiver remains for a result the server
actually emits.

## Live 0.163.0 reproduction

Used the actual pinned binary through `openCodexAppServer`, with
`experimentalApi: true`, a temporary Codex home/project, existing account
authentication, read-only permissions, and no host MCP or plugin configuration.
Temporary authentication copies were deleted when the process closed.

The persistent parent acknowledged a CSV-parser task whose agreed next step
was tests for quoted fields and malformed rows. The dedicated prediction RPC
still failed. The experimental fork then completed a real GPT6.1 Sol/low
inference turn using an independently written prediction prompt and JSON
output schema. Its result was:

```json
{"suggestion":"Add unit tests for quoted fields and malformed rows in the CSV parser."}
```

The fork had no persisted path, invoked no tools, and left the parent's turn
count at one. The prediction prompt was absent from parent history. This
validates generation and isolation, not a product-quality evaluation or UI
integration.

Local temporary evidence: `/private/tmp/codex-prediction-recheck-20261017/`:
`live-probe.json`, `probe.ts`, `provenance.json` and selected extracted/formatted
app bundles. These artifacts may be cleaned; the original bundles are not
copied into this repository.

## SuperOne integration boundary

Do not wait for the dedicated RPC to implement the feature. Use the same
experimental fork plus ordinary-turn pattern with a SuperOne-owned English
prompt; the official app's private configuration service is not required.

The generator should live in the Electron-free Codex package and be shared
by desktop and CLI. Feed its result into the existing `prompt_suggestion`
contract and desktop/mobile composer UI. Do not fabricate a provider-emitted
`thread/prediction/updated` event for a client-generated result.

Trigger only for an eligible successful parent turn; cancel and discard on a
new send, compaction, account/thread change or disposal. Keep a bounded timeout,
validate nullable JSON, preserve nonempty drafts and require user acceptance
before sending anything. Prediction is an additional inference call and should
have an explicit enablement/cost policy.

Prediction forks inherit tools and environments. Define prediction-only tool
admission and native-tool behavior before shipping; a prompt asking for text
alone does not enforce the absence of side effects. Reusing context must not
give a background suggestion authority to execute the suggested work.
