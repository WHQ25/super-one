# OpenCode backlog

Unused upstream capabilities and the decision on each. Decisions: `open`,
`adopt` (link the upgrade doc that lands it), `rejected` (keep the reason).

| # | Capability | Since | Benefit | Cost / risk | Decision |
|---|---|---|---|---|---|
| 1 | Prompt `delivery: steer` (mid-turn input) | 2.0 | Queued steer for OpenCode instead of a follow-up turn | 1.x has no steer; advertise negotiated capabilities per session | adopt: [native experiences](upgrades/experiences-2.0.27.md) |
| 2 | MCP OAuth through `/api/integration/*` | 2.0 | Sign in to MCP servers from SuperOne on 2.x | OAuth attempt flow differs from 1.x; local browser launch, shared controller forms | adopt: [OAuth and live catalogs](upgrades/oauth-catalog-2.0.27.md) |
| 3 | Skills (`/api/skill`, prompt `skills` attachments) | 2.0 | Skills in the slash menu on 2.x | Native command collisions take precedence; attach skill IDs, not skill text | adopt: [native experiences](upgrades/experiences-2.0.27.md) |
| 4 | 2.x support in the remote node (`packages/opencode`) | 2.0 | OpenCode 2 on remote nodes | Share the exact native client/translator; preserve V1 and process ownership | adopt: [remote node](upgrades/remote-node-2.0.27.md) |
| 5 | Live agent/skill/command catalog refresh for a running session | 1.x | Refresh the original session and push its catalogs to desktop/phone | V2 reload is global and cancels pending interactions; use a private idle server | adopt for desktop/node V2: [completion](upgrades/completion-2.0.27.md); V1 retains cold discovery |
| 6 | Generated `@opencode/client` | 2.0 | Replace handwritten V2 HTTP requests, SSE parsing and types | Preserve 1.x, private-server ownership, auth, canonical locations and explicit recovery failure | adopt: [2.0.27 migration](upgrades/client-2.0.27.md); lifecycle: [completion](upgrades/completion-2.0.27.md) |
| 7 | Official local service discovery/lifecycle | 2.0 | Reuse an authenticated local background service | Never use default service registrations; isolate native executor databases, config and authenticated MCP routes | adopt: [completion](upgrades/completion-2.0.27.md) |
| 8 | Streaming tool arguments/progress | 2.0 | Live argument previews and elapsed progress on desktop and phone | Canonical partial keys and final input reconciliation | adopt: [native experiences](upgrades/experiences-2.0.27.md) |
| 9 | Durable `session.log` and bounded observation recovery | 2.0 | Keep an existing turn across an event-source disconnect | Native 2.0.24 has replay gaps; reconcile bounded current-turn projections without retrying effects | adopt: [recovery and inbox](upgrades/recovery-inbox-2.0.27.md) |
| 10 | Native inbox list/cancel/delivery update | 2.0 | Manage already-accepted pending input from desktop or paired phone | Native acceptance differs from the host queue; preserve input identity and leased admission | adopt: [recovery and inbox](upgrades/recovery-inbox-2.0.27.md) |
| 11 | Remote native Steer/inbox/OAuth, live reload and rewind/fork | 2.0 | Same leased controls on desktop and paired phone for a node session | Preserve original proofs, accepted input identity and native history | adopt: [completion](upgrades/completion-2.0.27.md) |
| 12 | Node provider-store binding | 2.0 | Select node API credentials and models in native OpenCode | API-key compatible packages only; explicit failures cannot fall back to another account | adopt: [completion](upgrades/completion-2.0.27.md) |
