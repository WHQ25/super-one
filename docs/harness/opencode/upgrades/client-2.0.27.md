# OpenCode handwritten V2 client → @opencode/client 2.0.27

Status: executed · Date: 2026-10-13

## 1. Scope

Migrate the desktop V2 adapter to the exact published `@opencode/client` 2.0.27
(released 2026-10-12). Keep user-installed runtime discovery, private spawned
servers, explicit attached servers, and the existing 1.x SDK path. The remote
node's 2.x support and shared background-service ownership are separate work.

## 2. Upstream changes

| Version | Change | Tag | Note |
|---|---|---|---|
| 2.0.27 client | Generated Promise client and public wire types | [benefit] | Replaces manual requests, SSE parsing and protocol declarations |
| 2.0.27 client | Lazy shared event source | [impact] | Consume and await `server.connected` before returning a ready runtime |
| 2.0.27 client | Native output projections and paginated messages | [impact] | Session methods return data directly; catalog and message lists retain envelopes |
| 2.0.27 client | Declared API errors and per-request cancellation | [impact] | Preserve readable errors and close subscriptions on startup cancellation |
| 2.0.27 client | Local service lifecycle entrypoint | [none] | `ensure` can replace an existing service; not adopted in this migration |

## 3. Surface diff

All currently used V2 routes have generated methods. Adopt `session`, `message`,
`model`, `provider`, `agent`, `command`, `permission`, `mcp`, and `event` APIs.
Keep SuperOne's resource conversion and turn translator above the client.

## 4. Required changes

| Upstream change | SuperOne change |
|---|---|
| Generated client | Thin `OpenCodeV2Client` adapter with lazy SDK import |
| Published types | Derive adapter types from the Promise client's wire types |
| Lazy events | Await the connection marker with bounded startup and cancellation |
| Output projections | Adapt catalogs, messages, sessions, permissions and forms |
| Main SDK dependency | Exact desktop pin and lockfile; verify lazy loading |

## 5. Adopted capabilities

- [PLANNED] Landed: official Promise network client for desktop V2 sessions, resource
  discovery, and fork/move/delete administration.
- [VERIFY] Native agents, models, permissions, host MCP direct-tool admission,
  pending interaction snapshots, usage, shell turns and fork/revert behavior.
- [VERIFY] 1.x remains on its existing client and process management.
- [DEFERRED] Service discovery/ensure/stop, embedded SDK, remote-node V2 support,
  steer, skills and MCP OAuth.

## 6. Verification

- Red: the new subscription-readiness and startup-cancellation scenarios failed
  on the old adapter before implementation (9 existing client tests passed).
- Focused desktop OpenCode/backend/fork checks: 13 files, 119 tests passed. The
  opt-in live file skips without its explicitly configured private endpoint.
- Live: SDK 2.0.27 against installed OpenCode 2.0.24, isolated XDG directories and
  a temporary working directory. Resource discovery, connected marker, session
  creation/get/title, system instruction, native agent switch, pending permissions
  and forms, shell execution/event/message, fork, move, interrupt and deletion
  passed. No model prompt was sent. The private server was stopped afterward.
- `bun run typecheck:node`, dependency/lock consistency and `git diff --check`
  passed. Production main build uses the repository's main configuration; preload
  and renderer were omitted because this change only affects main. Lazy SDK import
  and main entry boundaries are checked in the resulting chunks.
- API inventory: all 140 generated native Promise methods recorded manually,
  including 33 used methods. The shared script does not have an OpenCode extractor.
- Not verified live: actual model prompts, edit/approval/form interactions,
  compaction, file rewind, 1.x runtime or Electron GUI acceptance. Those paths have
  the existing regression coverage plus the real-SDK mocked-network runtime tests.
  Remote-node V2 remains deferred.

## 7. Follow-ups

API ledger, contracts, backlog, integration README and changelog updated. Shared
service lifecycle and remote-node V2 remain in the backlog.
