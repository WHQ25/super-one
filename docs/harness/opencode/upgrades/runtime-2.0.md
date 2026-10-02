# OpenCode runtime 1.x → 2.x

Status: executed · Date: 2026-10-02 · Commit: see this file's Git history

## 1. Scope

The user's `opencode` binary moved to 2.x (Homebrew stable 2.0.20; verified with
2.0.22) while npm `opencode-ai` and `@opencode-ai/sdk` stay on 1.18. The SDK pin does
not change. Desktop now supports both runtimes; the remote node package stays 1.x.

## 2. Upstream changes

| Version | Change | Tag | Note |
|---|---|---|---|
| 2.0 | Server API replaced by `/api/*`; 1.x routes removed | [impact] | No SDK on npm; `@opencode-ai/client` beta already drifts from 2.0.22 |
| 2.0 | Basic auth always required; ready line renamed | [impact] | See contracts |
| 2.0 | Event stream: `session.text/reasoning/tool/step/execution.*` | [impact] | Replaces `message.part.*`, `session.idle` |
| 2.0 | Model, variant and agent are session state (`/model`, `/agent`) | [impact] | No longer prompt fields |
| 2.0 | System prompt through instruction entries | [impact] | Replaces prompt `system` |
| 2.0 | Questions become forms (`form.*`) | [impact] | |
| 2.0 | Revert is `stage` / `commit` / clear | [impact] | |
| 2.0 | MCP code mode | [impact] | Host server registered with `codemode: false` |
| 2.0 | Share endpoints removed | [impact] | `/share`, `/unshare` unavailable on 2.x |
| 2.0 | `delivery: steer` | [benefit] | Backlog #1 |

## 3. Surface diff

The 1.x ledger is not started, so there are no rows to map. The 2.x routes SuperOne
calls are the methods of `apps/desktop/src/main/opencode/opencode-v2-client.ts`.

## 4. Required changes

| Upstream change | SuperOne change |
|---|---|
| New API | `OpenCodeV2Client` and `createOpenCodeV2Runtime` behind the same `OpenCodeRuntime` |
| Auth | Spawned servers get a generated `OPENCODE_SERVER_PASSWORD` |
| Version | `startOpenCodeServer` reports `protocol` from the ready line (spawned) or `/api/info` (attached) |
| Events | `OpenCodeV2TurnTranslator`; backend shares permission, question and compaction handling |
| Snapshot on resume | `snapshotEvents` replaces the 1.x-shaped todo/permission/question fields |
| Fork, side-chat delete, resource probe | `withOpenCodeSessionAdmin`, `probeOpenCodeResources` pick the client by protocol |

## 5. Adopted capabilities

- [DEFERRED] Steer, MCP OAuth, skills, remote node — backlog #1–#4.

## 6. Verification

- Unit: `opencode-v2-client`, `opencode-v2-event-map`, `opencode-backend-v2` tests;
  1.x suites unchanged in behavior; `vitest related` over the changed files.
- Live (2.0.22, free OpenCode Zen model, temporary git repository): resource probe;
  edit permission approved; tool and text deltas; usage metadata; question form
  answered; interrupt; `!` shell turn; rewind preview and revert restoring the file,
  including from a symlinked directory; fork and delete.
- Cross-model review (Codex): seven findings fixed with regression tests — stale
  shell end after interrupt, sticky agent kept when a send names none, snapshot
  replay of interactions resolved during startup, symlinked locations, 1.x MCP
  disconnect for unregistrable configs, CRLF split across SSE chunks, subscription
  left open when startup aborts.
- Not verified live: MCP `terminal_tabs` host gate inside the app (verified against a
  stdio MCP server and in unit tests), 1.x after this change (unit tests only).

## 7. Follow-ups

- Contracts recorded in [contracts.md](../contracts.md); open items in [backlog.md](../backlog.md).
