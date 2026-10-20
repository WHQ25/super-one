# Remote desktop connect and first-open latency

Status: steps 1–4 measured · Updated: 2026-10-21
Related: [remote-switch-rpc-fanout.md](remote-switch-rpc-fanout.md) (per-switch RPC fan-out, separate branch)

## Problem

A desktop controlling another desktop that is not on its LAN reaches it through
the relay. Connecting took ~15 s on the user's stable 0.75.3 (MacBook → Mac
mini, `connect_result` `synchronizing` 21:04:48 → `connected` 21:05:03), and
the first open of each remote session takes 2–3 s.

## Measurements (2026-10-20, dev build, desktop-node lab over the production relay)

Setup: `SO_CF_RELAY_URL=wss://relay.super-one.dev` baked into A's dev build (B
reuses A's `out/`); B started with `SUPERONE_LAB_A_CDP_PORT=9` so it does not
re-pair; in A's `.dev-data/known-environments.json` the LAN profile target for
B pointed at an unresolvable `.local` host and mDNS results were discarded,
which is the off-LAN case. Temporary timing logs in
`NodeConnectionManager` (supervisor `connect`, `ensureAccess`, `getWsTicket`)
and `NodeRpcClient.rpc`.

Connect, total **14.6 s**:

| Step | Time | Where |
|---|---|---|
| Route resolution | 5.0 s | `NodeRouteResolver.resolve`: mDNS browse always waits its full 1.5 s (`browseLanServices`, `BROWSE_TIMEOUT_MS`), then the stored LAN `/health` probe runs to its 2.5 s timeout (`probeNodeIdentity`), then relay presence (~1 s) — sequential |
| `refreshNodeAccess` | 2.6 s | its own encrypted channel (`exchangeWithNode` → `secureChannelAuthRequest`, new relay slot via `createRelayNodeDialer`) |
| `mintWsTicket` | 2.6 s | another channel |
| Main WS + handshake | 3.2 s | third channel (`NodeRpcClient.doConnect`) |
| `environment.descriptor` | 0.5 s | first RPC |

On the LAN the same connect is ~1.55 s, of which 1.5 s is the fixed mDNS wait.

Relay RPC floor: every RPC ≥ ~0.55 s (A → relay → B → relay → A).
Session open over the relay: **first open 1.8–3.2 s**, reopen 0.6–0.9 s.
First open is serial in `hydrateRemoteSession`
(`apps/desktop/src/renderer/src/lib/remote-session-ops.ts`): `session.get`
(~0.65 s), then `openRemoteSession` → `session.transcriptWindow` (~0.8 s) as the
follow barrier, then `topic.subscribe`. The window read only overlaps the row
read when `previous.hostSessionOwned` is already true.

Bug seen in the same run: after a re-pair replaced the connection, the old
supervisor's dial loop (`for (let attempt = 1; ; attempt++)` in the supervisor
`connect`) kept trying routes on its disposed client, and its failures call
`onRouteFailed` → `NodeRouteResolver.markFailed`, excluding good routes for
2 minutes for the live connection too.

## Goal

Off-LAN connect ≤ 4 s (one relay channel setup plus presence), on-LAN connect
≤ 300 ms, first remote session open ≈ one relay round trip plus render.

## Steps

1. **One channel per connect.** Refresh, ticket and the RPC socket each open a
   full encrypted channel. Authenticate the main channel itself (refresh or a
   still-valid access token, then the ticket/proof) inside the channel that
   becomes the RPC socket, or reuse one channel for the auth exchanges and the
   socket. Keep the node's auth guarantees (device-key proof, refresh rotation,
   reuse revocation) unchanged. Old nodes (stable B on an earlier version) must
   still connect: gate on a served capability, keep the current path for them.
   Persist the access token with its expiry so a quick restart can skip
   refresh, only if that fits the credential store's security model.
2. **Route selection.** Do not wait LAN-then-relay in series. End the mDNS
   browse as soon as the target environment id answers; race the LAN probe
   with relay presence (happy-eyeballs: prefer LAN when it answers within a
   short grace window, otherwise take the relay). Keep `betterRoute`
   make-before-break for moving back to LAN later.
3. **Disposed dial loop.** A supervisor's `connect` loop must stop when its
   supervisor/client is disposed or superseded (generation check), and must
   never `markFailed` routes after that.
4. **First open.** In `hydrateRemoteSession`, start the window read beside
   `session.get` on first adopt too. The follow mapper needs the harness id
   from the row (`openInput(provider)`): either start the window read with the
   follow deferred until the row arrives, or derive the provider from the
   window state (`state.sessionProvider`). Keep the barrier semantics (events
   above the window cursor reach the chat once). Subscribe must not add a
   serial round trip after the window when the follower can be registered
   with the barrier cursor in the same request.
5. Do not touch the per-switch RPC fan-out (`listItems`, account/provider/git
   lists) — that is `perf/remote-switch-rpc-fanout`.

## Verification

- Re-run the relay lab above with temporary probes (remove them afterwards,
  restore `known-environments.json`, delete seeded rows). Record before/after
  for connect steps and for first/second open of three seeded sessions
  (seed B by `ATTACH`ing a `.backup` copy of a real profile DB and copying
  `projects`/`sessions`/`chat_messages`).
- LAN lab run: connect ≤ 300 ms, no regression in switch latency.
- Old-node compatibility: A on the branch connects to a B built from `main`
  (or a released CLI node) through both LAN and relay.
- Re-pair while a dial is in flight: the old loop stops, no route is excluded.
- Scoped tests: `bunx vitest related` for touched modules, the connection
  supervisor / route resolver / node-auth tests, `node-secure-channel` and
  `environment-host.relay` integration tests; `bun run typecheck:node` and
  `typecheck:web`.

## Results (2026-10-21, orin-a / orin-b, production relay)

Same lab shape as the baseline. Off-LAN was a stored LAN target that does not
resolve, with mDNS answers ignored for that run. Session rows were synthetic
(three sessions, 12 messages each): copying a personal profile was not
available in this run. Opens call `getSession` and `openRemoteSession` together,
which is the first-adopt path.

Relay connect, cold (access token expired). Total **7.3 s** (was 14.6 s):

| Step | Before | After |
|---|---|---|
| Route resolution | 5.0 s | 1.4 s |
| Refresh | 2.6 s, own channel | 0.59 s, on the RPC socket, ticket included |
| WS ticket | 2.6 s, own channel | included above |
| Channel setup + handshake | 3.2 s, third channel | 5.1 s for the one socket (dial, channel, auth, attach, handshake) |
| `environment.descriptor` | 0.5 s | 0.76 s |

A later connect with a still-valid access token skipped refresh and minted the
ticket on that same socket (0.61 s). Total **6.2 s** (route 1.3 s, socket 3.9 s,
descriptor 0.97 s). The ≤ 4 s goal is not met: one production-relay channel
setup is already about 4–5 s.

LAN connect, mDNS left on. Total **143 ms** (was ~1.55 s): route 120 ms, ended
when `lan-mdns` answered, socket 18 ms. The fixed 1.5 s browse wait is gone.

| Open | Before | After (relay, three sessions) |
|---|---|---|
| First | 1.8–3.2 s, serial | 584 / 574 / 612 ms |
| Second | 0.6–0.9 s | 616 / 572 / 572 ms |

`session.get` and `session.transcriptWindow` start together. The first window
RPC was 578 ms and the row RPC 531 ms; the open returned at 584 ms. No
`topic.subscribe` round trip followed the window.

Old node: desktop B built from `main` (`/health` has no `inlineAuth`). LAN
connect succeeded on the previous path (channel ready without `inlineAuth`,
then a separate ticket). Relay connect succeeded the same way (ticket channel
2.7 s, total 7.7 s).

Disposed dial: covered by `node-connection-manager.dial-loop.test.ts` (disconnect
while route resolution is in flight does not call `onRouteFailed`). Not repeated
in the lab.

`bunx vitest related` on the touched desktop and shared files: 610 files,
7781 tests passed. Named follow-ups also passed: node-auth (2), dial-loop (1),
`node-secure-channel` (2), `environment-host.relay` (2). `typecheck:node` and
`typecheck:web` passed. Runtime secure-channel tests, including one-socket
refresh plus attach, passed (6).
