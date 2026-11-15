# Cursor SDK API surface

Ledger version: `1.3.1` · partial · Check: none (`scripts/harness-api-inventory.ts` has no Cursor extractor)

Status vocabulary and row format: [docs/harness/README.md](../README.md#ledger-api-surfacemd).

This ledger lists the symbols the `1.3.1` bump starts using, plus the nearby
surfaces that bump explicitly leaves unused. It is not an inventory of
`dist/esm/index.d.ts`. Do not treat a missing name as `n/a` or as unused.
[D11](cursor-sdk-harness.md) still forbids a coverage percentage until the
public surface is inventoried and checked.

## Agent

| Name | Status | Usage | Code |
|---|---|---|---|
| `SDKAgent.summarize` | partial | Desktop local `/compact` only. Cloud, a missing saved conversation, and a busy agent throw before a run. Node one-shot turns do not call it and reject a `/compact` prompt | `packages/cursor/src/cursor-runtime.ts`, `packages/cursor/src/run-sdk-turn.ts` |
| `SDKAgent.send` | used | Local and cloud turns. Summary text on `onDelta` is ignored; stream `SDKSummaryMessage` becomes compact events | `packages/cursor/src/cursor-runtime.ts` |
| `Run.steer` | partial | Desktop local runs while a turn is streaming. Absent `steer` or no current run returns `revert_to_followup`. Node one-shot turns leave the capability off | `packages/cursor/src/cursor-runtime.ts`, `apps/desktop/src/main/session/backends/cursor-backend.ts` |
| `SteerAckOutcome` | used | `complete_delivered` consumes the host queue item. `revert_to_followup` restores it for a normal follow-up | `apps/desktop/src/main/session/backends/cursor-backend.ts` |
| `AgentOptions.systemPrompt` | unused | Replaces Cursor's built-in harness prompt, is account-gated, and is not stored on resume. Host context stays on the first user message | `packages/cursor/src/cursor-runtime.ts` |
| `AgentOptions.teamId` | unused | Omitted, so requests stay on the account's ambient team | — |

## Local options

| Name | Status | Usage | Code |
|---|---|---|---|
| `LocalAgentOptions.dirs` | partial | Desktop local create, resume, and workspace prewarm. Blank and duplicate entries are dropped. `cwd` stays the shell and store scope. Cloud agents omit `dirs`. Node one-shot turns report the capability off | `packages/cursor/src/cursor-local-options.ts`, `packages/cursor/src/cursor-workspace-prewarm.ts` |
| `LocalAgentOptions.fs` | unused | In-process file trees are not used. Sessions keep the host disk | — |
| `tempFs` | unused | Tree helper for `local.fs` | — |
| `unionFs` | unused | Tree helper for `local.fs` | — |
| `overlayFs` | unused | Tree helper for `local.fs` | — |
| `readOnlyFs` | unused | Tree helper for `local.fs` | — |
| `childOverlayFs` | unused | Tree helper for `local.fs` | — |
| `emptyFs` | unused | Tree helper for `local.fs` | — |

## Messages

| Name | Status | Usage | Code |
|---|---|---|---|
| `SDKSummaryMessage` | used | `running` emits compacting. `completed`, including `fallback: true`, emits `compact_boundary` then success. `error` emits compact failure and does not add a boundary. Summary text is not rendered | `packages/cursor/src/cursor-event-map.ts` |
| `computerUse` | partial | Tool-call display name only. The raw name `computeruse` renders as “Computer” | `packages/cursor/src/cursor-event-map.ts` |
| `tool-requests-listed` | unused | New `onDelta` kind. The mapper ignores unknown deltas | `packages/cursor/src/cursor-event-map.ts` |

## Cloud

| Name | Status | Usage | Code |
|---|---|---|---|
| `CloudAgentOptions.repos` | unused | SuperOne does not create no-repo agents (`repos: []`). Existing cloud sessions still resume when configured | `packages/cursor/src/cursor-local-options.ts` |
