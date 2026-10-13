# OpenCode V2 remote-node integration

Status: executed · Client: `@opencode/client` 2.0.27 · Date: 2026-10-13

## Scope

Use the existing V2 Promise adapter and turn translator on production headless
nodes. Preserve V1 execution and the shared session/RPC/history contracts. This
batch does not adopt the official shared-service lifecycle.

## Upstream changes

No additional SDK version bump. The published 2.0.27 Promise client uses
`Promise.withResolvers`; V2 initialization fails explicitly on unsupported Node
runtimes and asks for Node.js 22 or newer. The CLI's existing Node 20 baseline
continues to cover V1 and other harnesses.

## Surface diff

The native client, event translator, content/projection/recovery helpers and
permission rules now live in `packages/opencode/src`. Desktop keeps compatible
re-export entrypoints. The legacy SDK's `/v2` entrypoint still speaks OpenCode
1.x; it is not the native 2.x client.

Node V2 uses native session creation/resume, instruction and MCP registration,
model/variant and agent selection, prompt/skill/command/shell/compaction, warmed
events, finite logs, bounded message projections, permissions and forms.
Desktop-only OAuth, native inbox management, Steer, live location reload,
checkpoint/fork and manual observation Retry remain outside this node runner.

## Required changes

- [PLANNED] Share the exact-pinned client and pure translator; keep Electron and
  desktop tool registration out of the node package.
- [PLANNED] Dispatch V1/V2 after authenticated protocol detection. Generate a
  private server password, recognize both ready banners and stop only owned
  children; attached endpoint cleanup is a no-op.
- [PLANNED] Resolve the current enabled harness catalog at each turn/probe.
  Permit configured external endpoints without requiring a local executable.
- [PLANNED] Register the session's HMAC Host Action MCP with `codemode: false`;
  add exact safe host rules and preserve native resource-specific deny rules.
- [PLANNED] Persist the native resume ID before input dispatch and the selected
  agent in existing SQLite settings; reject agents on unsupported harnesses.
  Desktop drafts/turns and existing phone agent parameters reach the node;
  queued turns capture independent choices rather than reading a later selection.
- [PLANNED] Use durable leased permission/question waiters. Preserve native
  permission scopes, expose allow-once/deny only, and prevent generic presets or
  remembered tool names from overriding native approval requests.
- [PLANNED] Restore streaming tool results, usage and current-turn facts through
  shared events/history. Recover observation up to five times without resending;
  exhaustion terminates the node turn and closes its private server.
  Native terminal success wins over a lost HTTP receipt. Stop uses an independent
  bounded interrupt request after cancelling the turn's requests.
- [VERIFY] Preserve V1, desktop private/attached ownership, native event identity,
  delivery uncertainty and desktop recovery/inbox behavior after extraction.

## Adopted capabilities

Remote OpenCode V2 turns, native cold resource catalogs, persisted primary-agent
selection, native skills/commands and streaming tool argument/progress events.
The running node session advertises streaming input and keeps queued Steer off.
`/share` and `/unshare` fail explicitly instead of becoming model prompts.

## Verification

405 unique affected tests passed: 25 OpenCode package, 26 CLI, 70 shared runtime,
95 desktop native-client/runtime/recovery/inbox tests and 189 renderer payload/
scoped-write tests. Only the six changed OpenCode payload snapshots were updated.

The real node RPC smoke uses native OpenCode 2.0.24 with isolated XDG directories
and no model/account requests. It covers cold discovery, creation with Plan,
control proof rejection, duplicate-send receipts, native shell results, SQLite
history, node restart, native resume and an explicit Build switch from the next
client turn. A second native smoke resumes across two private processes.

OpenCode package, CLI, desktop main/renderer and mobile typechecks passed.
Desktop main production build passed. The node adapter bundles with the CLI's
CJS compatibility banner and imports successfully under Node 24.13.0.

Full CLI distribution bundling is blocked by unchanged `@cursor/sdk` dynamic
imports (`bun:sqlite` and `.d.ts.map` assets). No CLI tarball/release or installed
desktop/phone acceptance is claimed; the source RPC and isolated adapter were
checked independently. The Cursor package and CLI build configuration were not
changed as part of this OpenCode batch.

## Follow-ups

- [DEFERRED] Official shared-service lifecycle: ownership and per-session MCP
  credential isolation need a separate design.
- [DEFERRED] Remote native Steer/inbox/OAuth/live reload and checkpoint/fork
  controls; retain explicit capability boundaries.
- [DEFERRED] Node provider-store credentials into native OpenCode. This runner
  uses the node's own OpenCode configuration and authentication.
- Live paid-model turns, third-party MCP OAuth and physical phone acceptance
  remain unverified in this batch.
