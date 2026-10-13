# OpenCode V2 OAuth and live catalogs on client 2.0.27

Status: executed · Date: 2026-10-13

## Scope

Adopt native MCP integration OAuth attempts and reload Agents/Skills/Commands in
the existing desktop session. Reuse the paired controller's leased session RPC
and shared question forms. Keep V1 behavior and remote-node V2 unchanged.

The exact desktop V2 client remains `@opencode/client` 2.0.27. This batch adopts
six additional generated methods; 40 of the 140 native Promise methods are used.

## Upstream surface

- `mcp.list` identifies each server's `integrationID`.
- `integration.get` offers OAuth methods and optional input forms.
- `integration.oauth.connect/status/complete/cancel` owns the attempt and tokens.
- `location.reload` rebuilds all loaded locations and cancels pending native
  permissions/forms. Only reload a managed private server while its session is
  idle and has no outstanding interaction or authentication attempt.

## Implementation

- `opencode-oauth.ts` owns one active flow per MCP server, optional method/forms,
  automatic callbacks or pasted codes, polling, expiry, cancellation and cleanup.
  Authorization opens the local desktop browser; OpenCode owns credentials and
  callback validation. Successful attempts reconnect the named MCP server and
  broadcast its status. Shared question replies never become model prompts or
  persisted user messages.
- `session.refreshResources` is an optional mutating operation with existing
  control proofs and request deduplication. Desktop and mobile refresh the owning
  native session and receive the catalog through cached/replayed `session_agents`.
  Sends wait for explicit reload; session IDs and event subscriptions are kept.
  Lease checks occur again immediately before native mutations after awaits.
- Runtime catalog getters stay current. Location-scoped agent/skill/command
  notifications trigger debounced reads without reload or execution interruption.
  Notifications arriving during a read trigger another read.
- Reload returns before project agents necessarily initialize. Prime the native
  catalogs, wait up to three seconds for `agent.updated`, then read again before
  replacing the catalog or switching away from a removed selected agent. Preserve
  the initial restored agent; after refresh a removed agent falls back to Build
  or the first visible primary agent.

## Boundaries

Explicit reload rejects busy sessions, pending approvals/questions/OAuth and
attached servers because the native operation affects all loaded locations.
Restore host MCP registration after reload. V1, draft and older-host refresh
retain cold discovery. The separate remote node still supports V1 only.

OAuth launch remains local desktop only. Paired controllers can answer/cancel
shared forms with control rights; this does not add a phone-native browser login
entry. Native `external` form fields fail explicitly. Shared-service lifecycle,
stream reconnection/replay and remote-node V2 remain backlog work.

## Verification

- Seven desktop native/runtime/backend/LAN/relay regression files: 88 passing
  tests. Desktop agent/MCP controls: 26 passing tests. Mobile agent/composer
  components: 30 passing tests; mobile owning-session catalog refresh: 3 passing
  tests, including navigation during capability discovery.
- Desktop Node/Web and mobile typechecks passed. Main-process production build
  passed; `@opencode/client` remains a lazy V2 chunk dependency.
- Production Storybook agent refresh loaded the updated session catalog, busy
  refresh retained the existing catalog with the concrete error, and OAuth code
  entry enabled submission. Automatic waiting uses the same question control.
- Three opt-in tests passed against an isolated real OpenCode 2.0.24 server:
  native MCP OAuth discovery/registration/callback/token exchange/reconnection;
  original-session agent/command/skill reload; client resource/shell/session and
  inbox smoke. Repeated reload verified the asynchronous initialization boundary.
  OAuth uses a local fixture provider; no third-party account or model was used.
- Third-party account sign-in, physical-phone interaction and model execution
  acceptance remain unverified. No installed-app rebuild/release was performed.
