# OpenCode V2 integration completion

Status: executed · Client: `@opencode/client` 2.0.27 · Date: 2026-10-13

## Scope

Finish the recorded desktop/node integration gaps on the current client pin:
remote native Steer, inbox, OAuth, live catalogs, checkpoints/fork, node provider
credentials and authenticated local service lifecycle with session isolation.
Preserve V1, existing migrations and process ownership. No release or commit.

## Upstream changes

No SDK bump. Recheck the published Promise contracts and native behavior as each
capability is adopted. Native MCP calls provide `ai.opencode/sessionID` metadata;
that value alone is not authentication and cannot authorize host tools.

## Surface diff

Shared persistent native runtime and OAuth state machine behind host ports.
Node operations use the original control proof and durable interaction waiters.
Managed V2 services have separate registration, configuration and session databases;
V1 and explicit endpoints retain their existing ownership.

## Required changes

- [DONE] Share the V2 persistent runtime and OAuth state machine.
- [DONE] Wire node operations through durable leased callbacks and recheck
  captured mutation proofs after async initialization/recovery.
- [DONE] Native queued Steer, inbox controls and manual observation recovery.
- [DONE] Remote MCP OAuth and original-session catalog refresh.
- [DONE] Native checkpoint/history identity, rewind and independent fork.
- [DONE] Node provider-store credentials into native OpenCode.
- [DONE] Official service discovery/ensure/stop confined to owned registration
  files; isolate concurrent sessions' authenticated host MCP routes.
- [DONE] Desktop/node/phone contracts, V1, native smoke and packaging boundaries.

## Adopted capabilities

Production nodes advertise native Steer, inbox operations, OAuth, catalog refresh,
rewind and manual reconnection. Session catalogs carry models independently of the
project fallback. Node provider bindings support OpenAI Chat/Responses and Anthropic
Messages through native packages, without writing keys into project config.

`Service.discover/ensure/stop` use only SuperOne-owned files. A logical session
keeps a stable private `OPENCODE_DB` across process and credential changes. Cold
resume/fork migration uses a read-only WAL snapshot, retains its conversation and
native child sessions/credentials, prunes unrelated sessions, and clears old
executor claims before startup. Unknown database layouts fail closed.

Native 2.0.24 resumes suspended sessions from a shared database when another
process starts; separate endpoints/config alone are insufficient isolation.
Its MCP tool registry also debounces changes for 100ms: host tools are configured
at startup and given a bounded connected-catalog settlement before input.
Real same-directory concurrent MCP calls verify separate credentials and metadata.

Adding native `queue` input to an idle conversation can start an execution before
that input is delivered. Explicit inbox adoption owns that existing execution;
shell completion itself remains an independent terminal.

## Verification

Focused checks (545 unique cases; repeated runs are not added):

| Surface | Cases | Coverage |
|---|---:|---|
| Desktop/main/renderer/phone contracts | 350 | V1/V2 runtime, events, recovery, inbox, fork/side-chat, native queue, model/agent selection and LAN/relay operations |
| Shared runtime | 39 | Queue, durable history, leased interactions/RPC and Stop/admission races |
| CLI routing/provider contracts | 32 | Resources, provider selection, fork and runtime readiness |
| OpenCode shared package | 31 | Client routing, database isolation, provider configuration, OAuth, steering and attached ownership |
| Mobile | 80 | Session-scoped model synchronization, native controls, queue and streaming projection |
| Shared chat core | 4 | Runtime agent/model catalog state |
| Production native node RPC | 6 | Crash replacement/no resubmission, idle and active inbox, credential rotation, Steer/fork continuation/cold rewind, MCP OAuth and node restart |
| Native service/MCP isolation | 3 | Real read-only conversation import and safe catalog discovery, service references, concurrent same-directory authenticated tools |

Typechecks passed for desktop main/renderer, mobile, CLI, shared runtime and
OpenCode. The complete desktop main/preload/renderer build, shared mobile chat/
terminal documents, and the standalone OpenCode ESM adapter bundle/import passed.
SDK pin: 2.0.27; live native binary: 2.0.24. Local HTTP/model/MCP fixtures and
isolated directories were used; no external model account or provider bill.
Production component stories include `OpenCodeNodeCredential` and its narrow
variant in `HarnessControls.stories.tsx`.

No full-suite, paid-account, installed-app, visual UI, release or physical-phone
acceptance is implied. Provider bindings support compatible API keys, not native
account synchronization, AWS identity, or provider OAuth. Existing native
credentials seed a new private scope; later global CLI account changes need a new
scope. Attached endpoints require dedicated external isolation across processes.
Unknown native database layouts fail closed rather than pretending migration.

## Follow-ups

The unrelated Cursor SDK's dynamic `bun:sqlite` and `.d.ts.map` imports still
block the complete CLI bundle. Validate the OpenCode adapter independently.
