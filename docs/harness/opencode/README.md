# OpenCode integration

V2 client pin: `@opencode/client` `2.0.27` · V2 ledger: 2.0.27 ·
Legacy SDK: `@opencode-ai/sdk` `^1.18.26` (installed 1.18.26) ·
Last updated: 2026-10-13

## Upstream

- Desktop and node V2 client: [`@opencode/client`](https://opencode.ai/v2/docs/build/client/)
  `2.0.27`, imported lazily through the Promise entrypoint. The thin adapter keeps
  SuperOne's resource conversions, canonical directories and catalog settlement.
- Legacy client: [`@opencode-ai/sdk`](https://www.npmjs.com/package/@opencode-ai/sdk),
  with `@opencode-ai/models` `^0.0.62` for the 1.x model catalog.
- Runtime: the user's own `opencode` binary, found on `PATH`; SuperOne does not pin it.
  Both 1.x and 2.x are supported on desktop and remote nodes. 2.x replaced the server API with `/api/*`,
  SuperOne calls it through the generated client. Private spawned servers and
  explicit attached endpoints retain their process ownership. Owned V2 runtimes
  use official service discovery/lifecycle with per-session databases and MCP
  credentials; user-owned default services are never replaced. `@opencode-ai/client` is the
  older pre-release package, not the current V2 client. A client pin does not
  upgrade the user's executable.
- The legacy SDK is still a caret range; its full ledger is separate from the
  exact-pinned V2 Promise client ledger.

## Integration shape

| Runtime | Entry | Notes |
|---|---|---|
| Desktop sessions | `apps/desktop/src/main/session/backends/opencode-backend.ts` | One backend for both protocols |
| Desktop protocol detection | `apps/desktop/src/main/opencode/opencode-client.ts#startOpenCodeServer` | `GET /api/info` version ≥ 2 → `v2` |
| Desktop 1.x runtime | `apps/desktop/src/main/opencode/opencode-runtime.ts` | `@opencode-ai/sdk` |
| Desktop 2.x runtime | `apps/desktop/src/main/opencode/opencode-v2-runtime.ts` | `@opencode/client` through `opencode-v2-client.ts`; existing turn translator |
| Core (remote node) | `packages/opencode/src/managed-runner.ts` | Persistent V2 runtime and leased operations; original V1 dispatch |
| Shared V2 runtime | `packages/opencode/src/native-runtime.ts` | Pure runtime/OAuth/recovery; desktop and node host ports |
| Owned services | `packages/opencode/src/owned-service.ts` | Official lifecycle, reference/owner proofs and private native databases |
| Node launch and discovery | `packages/opencode/src/launch.ts` | Resolve enabled catalog per turn; private server or configured endpoint; native cold catalogs |
| Runtime discovery | `packages/runtime/src/harness/enable.ts` | Resolves `opencode` on `PATH` |

## Native agents and permissions

Desktop and its mobile controller select OpenCode primary agents (`build`, `plan`,
and custom agents) independently of model and effort. The agent selector occupies
the chat bar's behavior slot and has its own catalog refresh. An unset agent is
left to OpenCode's configured default or the resumed session's selected agent.

OpenCode does not expose Claude permission modes. SuperOne advertises an empty
permission-mode catalog and inherits OpenCode's rules and native approval flow.
It adds exact-name host-tool admission rules only; executor authorization remains
separate. On resume, the old SuperOne blanket presets are removed, while native
resource-specific session rules are retained. Legacy Plan launches seed the
native Plan agent; subsequent explicit agent selections take precedence.

The shared `permissionMode: 'default'` field remains a compatibility wire value,
not an OpenCode mode or a wildcard permission rule. Node V2 retains native
approval scopes through durable leased waiters and offers allow-once/deny;
saved native patterns are not exposed by that waiter. Legacy generic permission
presets and session tool-name allows cannot bypass native V2 approvals.

Desktop IPC and mobile `get_system_info` share
`apps/desktop/src/main/opencode/opencode-resources.ts`. Both discover models,
agents and commands on demand, without needing a previous desktop session.
Discovery caches are keyed by directory because agents and commands are
location-specific; concurrent requests for the same directory share a probe.
Explicit mobile refresh forwards `force` to bypass the host's disk cache;
ordinary revalidation retains the shared TTL and cached values on failure.
The mobile selection state preserves an empty permission-mode catalog instead
of synthesizing a selectable Default mode. An unset agent is displayed as Default.

## Native experiences

Desktop and remote node V2, with their paired phone controllers, offer native queued-message
steering, native skills and streaming tool argument/progress previews. These are
advertised by the session runtime in the cached `session_agents` envelope; the
shared OpenCode baseline stays off for V1. Remote V2 advertises streaming tool
input and the same native Steer action; host composer cards remain distinct from
already-accepted native inbox input.
Steering uses the next native safe point without cancelling the running tool;
only one Steer action is offered. Skills dispatch through prompt ID attachments,
with native commands taking precedence for colliding slash names.

The directory resource cache uses a `native-skills-v1` key so older fresh
catalogs are probed once for skills. A running session's native catalog wins over
the project-wide fallback on desktop and phone, including worktree sessions.

The existing MCP Authenticate action now uses V2 native OAuth attempts. It opens
the local desktop browser, supports automatic callbacks or pasted codes, and
reconnects that MCP server after success. Method inputs, codes and cancellation
reuse shared question controls, including a paired phone with control rights.

Refresh Agents/Models reloads the current V2 session's Agents/Skills/Commands
through a leased session operation. Native catalog notifications also push
location-scoped updates without interrupting a turn. Explicit reload requires an
idle managed private server with no pending approvals, questions or OAuth; an
attached server cannot safely perform this global reload. Drafts, V1 and older
hosts retain cold discovery. Remote nodes probe their own native cold catalogs
through `harness.resources` and refresh the original running session through the
same leased operation. Models, agents and commands follow the session catalog.

Remote MCP OAuth opens on the controlling desktop/phone. For automatic methods,
the controller pastes the completed localhost callback URL; the node verifies its
origin, path and state before forwarding it to the native callback listener.

Node `chat:opencode` provider bindings use native OpenAI Chat/Responses or
Anthropic-compatible packages. Keys enter process environment, models are scoped
to the selected credential, and idle credential rotation retains native history.
Explicit unavailable credentials fail closed. These bindings require owned V2;
V1 and attached endpoints do not silently use another account.

Owned native databases retain existing native credentials and the requested
conversation through a read-only snapshot when first migrated. Each runtime then
owns its credential/session copy; later global CLI account changes require a new
runtime scope rather than mutating an unrelated live session.

## Pin locations

| Location | What |
|---|---|
| `packages/opencode/package.json` | `@opencode/client` 2.0.27, `@opencode-ai/sdk` |
| `apps/desktop/package.json` | `@opencode/client`, `@opencode-ai/sdk`, `@opencode-ai/models` |

Event-source disconnects now recover the same V2 session through a durable cursor
and bounded current-turn projection fallback. Five failed attempts leave a Retry
or Stop state; neither automatic nor explicit observation recovery resends input.
Native pending user input has shared desktop/phone Queue/Steer and withdrawal
controls, separate from the host-held composer queue. Mutation proofs survive
backend async boundaries and are rechecked at native dispatch. Node V2 shares the persistent runtime, including bounded observation recovery,
manual Retry/Stop, and native inbox controls. A replaced owned process interrupts
the old execution without resubmitting its input.

Node V2 requires Node.js 22 or newer because the published client calls
`Promise.withResolvers`. Native session IDs and agent selections survive node
restart in SQLite. Nodes use native configuration/authentication or an explicit SuperOne provider-store
API-key binding. Cold desktop/node discovery uses a temporary credentials-only
database and cannot resume unrelated native executions.

## Documents

- [api-surface.md](api-surface.md) · [contracts.md](contracts.md) · [backlog.md](backlog.md)
- Upgrade docs: [upgrades/runtime-2.0.md](upgrades/runtime-2.0.md),
  [upgrades/client-2.0.27.md](upgrades/client-2.0.27.md),
  [upgrades/experiences-2.0.27.md](upgrades/experiences-2.0.27.md),
  [upgrades/oauth-catalog-2.0.27.md](upgrades/oauth-catalog-2.0.27.md),
  [upgrades/recovery-inbox-2.0.27.md](upgrades/recovery-inbox-2.0.27.md),
  [upgrades/remote-node-2.0.27.md](upgrades/remote-node-2.0.27.md),
  [upgrades/completion-2.0.27.md](upgrades/completion-2.0.27.md),
  [upgrades/review-fixes-2.0.27.md](upgrades/review-fixes-2.0.27.md)

## Version history

| Version | Date | Status | Upgrade doc | Commit |
|---|---|---|---|---|
| runtime 2.x (desktop) | 2026-10-02 | executed | [runtime-2.0.md](upgrades/runtime-2.0.md) | |
| client 2.0.27 (desktop V2) | 2026-10-13 | executed | [client-2.0.27.md](upgrades/client-2.0.27.md) | |
| native experiences (client 2.0.27) | 2026-10-13 | executed | [experiences-2.0.27.md](upgrades/experiences-2.0.27.md) | |
| OAuth and live catalogs (client 2.0.27) | 2026-10-13 | executed | [oauth-catalog-2.0.27.md](upgrades/oauth-catalog-2.0.27.md) | |
| Recovery and native inbox (client 2.0.27) | 2026-10-13 | executed | [recovery-inbox-2.0.27.md](upgrades/recovery-inbox-2.0.27.md) | |
| Remote node V2 (client 2.0.27) | 2026-10-13 | executed | [remote-node-2.0.27.md](upgrades/remote-node-2.0.27.md) | |
| Completion (client 2.0.27) | 2026-10-13 | executed | [completion-2.0.27.md](upgrades/completion-2.0.27.md) | |
| Review fixes (client 2.0.27) | 2026-10-13 | executed | [review-fixes-2.0.27.md](upgrades/review-fixes-2.0.27.md) | |
