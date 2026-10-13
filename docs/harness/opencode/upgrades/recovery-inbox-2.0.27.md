# OpenCode V2 recovery and inbox on client 2.0.27

Status: executed · Date: 2026-10-13

## Scope and surface diff

Recover an existing desktop V2 session after event-source disconnection and expose
its native pending user input on desktop and its paired phone. No pin change:
`@opencode/client` remains exactly 2.0.27. Four additional generated methods are
used: `session.log` and `session.inbox.list/cancel/update` (44 of 140).

V1, the separate remote-node runner and private process ownership remain on their
existing contracts. Official shared-service lifecycle and remote-node V2 are
separate open backlog items. No commit, PR or release is part of this batch.

## Required changes

- [ADOPTED] Five bounded observation attempts, an exclusive aggregate cursor,
  warmed live subscription and replay/live deduplication. A missing sequence uses
  the current turn's authoritative native message projection before settling.
- [ADOPTED] Capture the pre-dispatch message boundary and page newest-first until
  it. Bound replay to 20,000 events / 10 seconds and projections to 100 pages of
  100 messages / 10 seconds. Missing boundaries fail explicitly; pending input,
  form and permission reads have five-second limits.
- [ADOPTED] Stable text/reasoning block IDs, full-value replacement and tool IDs
  scoped by assistant step. Repeated projections do not restart completed tools,
  duplicate usage or create another compaction boundary.
- [ADOPTED] Reconcile native pending permission/form/inbox state. Remove resolved
  interactions without inventing approval. OAuth helper forms retain their own
  lifecycle. Refresh read-only catalogs without a global location reload.
- [ADOPTED] Preserve native execution and host turn on recovery exhaustion. The
  shared disconnected banner supports explicit observation Retry or normal Stop.
  New input and native mutations wait for the readiness barrier. Neither path
  retries prompts, commands, shell effects or OAuth answers.
- [ADOPTED] Native inbox list, withdraw and Queue/Steer controls through advertised
  shared session methods. Lists and reconnect are reads and never cold-start a
  runtime. Cancel/update require control proofs and successful request receipts.
- [ADOPTED] Capture the frontend's exact lease/generation before entering a
  host-owned backend, then recheck it inside the lazy native mutation callback.
  Successful inbox RPCs use `{ ok: true }`; `null` is ambiguous to the existing
  receipt lookup. LAN/relay duplicate requests run only once.
- [ADOPTED] Idle native Steer adopts the existing accepted input instead of sending
  another prompt. Original host user IDs carried by native metadata keep new
  checkpoints on their corresponding bubbles in persistence and shared reducers.
- [DEFERRED] Remote-node V2 and official shared-service lifecycle.

## Compatibility observations

The isolated 2.0.24 native server advanced its log head but returned only
`log.synced` for missed enqueue/cancel and shell-completion records. Raw HTTP
reproduced this log gap. The projection fallback recovered a shell completion
into the original host assistant turn with exactly one submitted shell request.

Message cursors encode ordering: combining `cursor` with `order` is rejected.
Descending `cursor.next` walks older records, including the final empty page.
Inbox delivery updates are transitions; repeated Queue-to-Queue is rejected.
A native Steer input with `resume: false` changed to Queue without model execution.

Upstream [session lifecycle source](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/session.ts)
and [session contract](https://github.com/anomalyco/opencode/blob/dev/specs/v2/session.md)
explain the native acceptance and observation split. Local behavior above was
verified against the installed native binary rather than inferred from `dev`.

## Verification

- Twenty desktop/main/UI/transport regression files: 279 unique passing tests
  (278 in the combined run plus one added projection-abort case). Includes V1
  queue behavior, native adoption, loss of control during delayed dispatch,
  connection exhaustion/manual retry, projection overlap, checkpoint persistence,
  OAuth/catalog compatibility and LAN/relay request receipts.
- Mobile runtime/native-action tests: 43 passing. Built WebView document E2E:
  three passing cases for English/light, Chinese/dark at 320 px, and observation
  Retry. They assert actual bridge payloads, asynchronous replies and error retry.
- Five isolated native smoke cases passed: same-turn shell recovery, native
  inbox list/delivery/cancel, native skill enqueue, catalog reload and OAuth fixture.
  No third-party account, paid model or physical phone was used.
- Desktop Node/Web, mobile and chat-view typechecks passed. Main-process and
  generated chat/terminal document builds passed; SDK loading remains a lazy V2
  chunk. No repository-wide test suite was run.
- Production stories in `packages/chat-view/src/session-provider-state.stories.tsx`
  cover success, empty, saving, error/retry, read-only, recovering, disconnected
  and long/narrow content. Success/error/reconnect plays ran in Storybook; loading
  and read-only disabled controls and Chinese dark 320 px layout were checked.

## Limits

Exactly-once native business effects are not claimed. Lost acknowledgements are
uncertain and never trigger automatic input resubmission. A recovered assistant's
buffered ephemeral deltas are suppressed until authoritative full values arrive;
new steps stream normally. Ephemeral Code Mode/plugin subcall traces cannot be
reconstructed from message projections. An external pending input without host
metadata restores its text and native checkpoint, not attachment bytes from a
count. Actual model steering, installed desktop acceptance, physical-device and
external OAuth-account acceptance remain unverified.
