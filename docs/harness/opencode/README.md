# OpenCode integration

Pin: `@opencode-ai/sdk` `^1.18.26` (installed 1.18.26) · Ledger version: not started ·
Last updated: 2026-10-07

## Upstream

- Client: [`@opencode-ai/sdk`](https://www.npmjs.com/package/@opencode-ai/sdk), with
  `@opencode-ai/models` `^0.0.62` for the model catalog.
- Runtime: the user's own `opencode` binary, found on `PATH`; SuperOne does not pin it.
  Both 1.x and 2.x are supported on desktop. 2.x replaced the server API with `/api/*`,
  SuperOne calls it through a hand-written client typed from the 2.0.22 OpenAPI
  document. Upstream now publishes the generated
  [`@opencode/client`](https://opencode.ai/v2/docs/build/client/) (latest 2.0.24
  verified on 2026-10-07), including authenticated local service discovery.
  Migration remains a separate integration task; `@opencode-ai/client` is the
  older pre-release package, not the current V2 client.
- The SDK dependency is a caret range. Pin it exactly before starting a ledger, or the
  ledger version cannot be stated.

## Integration shape

| Runtime | Entry | Notes |
|---|---|---|
| Desktop sessions | `apps/desktop/src/main/session/backends/opencode-backend.ts` | One backend for both protocols |
| Desktop protocol detection | `apps/desktop/src/main/opencode/opencode-client.ts#startOpenCodeServer` | `GET /api/info` version ≥ 2 → `v2` |
| Desktop 1.x runtime | `apps/desktop/src/main/opencode/opencode-runtime.ts` | `@opencode-ai/sdk` |
| Desktop 2.x runtime | `apps/desktop/src/main/opencode/opencode-v2-runtime.ts` | `opencode-v2-client.ts`, `opencode-v2-event-map.ts` |
| Core (remote node) | `packages/opencode/src` | `agent-event-mapper.ts`, `parse.ts`; 1.x only |
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
not an OpenCode mode or a wildcard permission rule. The minimal remote-node
runner in `packages/opencode` remains a separate, incomplete integration.

Desktop IPC and mobile `get_system_info` share
`apps/desktop/src/main/opencode/opencode-resources.ts`. Both discover models,
agents and commands on demand, without needing a previous desktop session.
Discovery caches are keyed by directory because agents and commands are
location-specific; concurrent requests for the same directory share a probe.
Explicit mobile refresh forwards `force` to bypass the host's disk cache;
ordinary revalidation retains the shared TTL and cached values on failure.
The mobile selection state preserves an empty permission-mode catalog instead
of synthesizing a selectable Default mode. An unset agent is displayed as Default.

## Pin locations

| Location | What |
|---|---|
| `packages/opencode/package.json` | `@opencode-ai/sdk` |
| `apps/desktop/package.json` | `@opencode-ai/sdk`, `@opencode-ai/models` |

## Documents

- [api-surface.md](api-surface.md) · [contracts.md](contracts.md) · [backlog.md](backlog.md)
- Upgrade docs: [upgrades/runtime-2.0.md](upgrades/runtime-2.0.md)

## Version history

| Version | Date | Status | Upgrade doc | Commit |
|---|---|---|---|---|
| runtime 2.x (desktop) | 2026-10-02 | executed | [runtime-2.0.md](upgrades/runtime-2.0.md) | |
