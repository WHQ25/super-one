# OpenCode V2 native experiences on client 2.0.27

Status: executed · Date: 2026-10-13

## 1. Scope

Use the already pinned Promise client to add queued-message steering, native
skill discovery/attachments, and streaming tool arguments/progress on desktop
and its mobile controller. Keep 1.x behavior and remote-node scope unchanged.

## 2. Upstream changes

These are V2 service capabilities exposed by the generated client, not new
features introduced by the 2.0.27 release alone.

| Interface | Tag | Adoption |
|---|---|---|
| `session.prompt` delivery `steer` | [benefit] | Convert a host-held queued message into active execution input |
| `skill.list` and prompt `skills` | [benefit] | Native skills in slash catalogs; send stable skill IDs |
| `session.tool.input.delta` | [benefit] | Existing shared streaming-input pipeline |
| `session.tool.progress` | [benefit] | Existing shared tool progress UI |

## 3. Surface diff

No dependency bump. Add the used API/event rows to the current V2 ledger.

## 4. Required changes

- Runtime-specific capabilities in the cached session-native catalog; 1.x must
  not expose V2-only steering actions.
- Reuse host queue admission/rollback, session mutation fencing, and mobile RPC.
- Preserve active execution ownership while a steering admission races terminal
  events; do not create duplicate turns or silently resend uncertain delivery.
- Discover native skills by location and attach IDs when dispatching their slash
  entries. Keep native command precedence for colliding names.
- Translate argument deltas/progress without changing native permission input.

## 5. Adopted capabilities

- [ADOPTED] Steer, native skills, streaming input and progress on desktop and its
  paired mobile controller. V1 gates remain off.
- [VERIFIED] Queue cancellation, safe rejection restoration, uncertain delivery
  without automatic resend, completion/admission races and checkpoint correlation.
- [VERIFIED] Replayed native session catalogs, desktop/mobile capability controls,
  canonical partial tool aliases and authoritative final input reconciliation.
- [DEFERRED] OAuth, reconnect/replay, shared-service ownership, remote-node V2.

## 6. Verification

- Red/green: native skill dispatch/catalog, tool delta/progress and shared runtime
  catalog tests failed before their implementation. Admission races and checkpoint
  mapping use the backend and shared chat reducer together.
- Desktop: 112 focused OpenCode/backend tests, 52 additional tool UI/slash/phone
  contract tests, and 10 selected Session dispatch/admission tests passed. Existing
  ChatInput/ChatContent coverage also passed. These are scoped checks,
  not a full monorepo suite.
- Shared/mobile: catalog and partial-input tests, queued-send/slash/projection
  tests, composer catalog/capability hook tests, and transcript bridge tests passed.
- Desktop node/web, mobile, chat-core and chat-view typechecks passed. Production
  main build passed with the existing lazy SDK chunk boundary. Mobile's final
  chat-view build passed, including the changed shared presenter rendered in stories.
- Storybook browser: production desktop and portable queues show V2 Steer and
  suppress V1 controls; the narrow native skill catalog renders in dark theme;
  Write/Patch previews and CodeExecution's expanded partial source render without
  browser errors. A missing nested mailbox mock in Storybook was filled in.
- Live: client 2.0.27 against installed OpenCode 2.0.24 in temporary XDG/location
  directories. Native skill discovery and skill-only `delivery: steer` admission
  confirmed through the native SSE inbox payload, using `resume: false` (no model
  execution). Session administration, shell event/history and cleanup also passed.
- Not live-verified: real model steering/safe-point continuation, image steering,
  native V1 binary acceptance, installed Electron GUI or physical phone interaction.
  LAN/relay routing and duplicate RPC receipts have deterministic contract coverage.

## 7. Follow-ups

API ledger, contracts, backlog, integration README, experience matrix and changelog
updated. OAuth, reconnect/replay, shared-service ownership and remote-node V2 remain
explicit backlog work.
