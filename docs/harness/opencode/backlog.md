# OpenCode backlog

Unused upstream capabilities and the decision on each. Decisions: `open`,
`adopt` (link the upgrade doc that lands it), `rejected` (keep the reason).

| # | Capability | Since | Benefit | Cost / risk | Decision |
|---|---|---|---|---|---|
| 1 | Prompt `delivery: steer` (mid-turn input) | 2.0 | Queued steer for OpenCode instead of a follow-up turn | Capability is per harness while 1.x has no steer; needs per-runtime capability data | open |
| 2 | MCP OAuth through `/api/integration/*` | 2.0 | Sign in to MCP servers from SuperOne on 2.x | OAuth attempt flow differs from 1.x `mcp.auth.authenticate` | open |
| 3 | Skills (`/api/skill`, prompt `skills` attachments) | 2.0 | Skills in the slash menu on 2.x | 1.x listed skills as commands; 2.x needs attachments | open |
| 4 | 2.x support in the remote node (`packages/opencode`) | 2.0 | OpenCode 2 on remote nodes | Second client in the node package | open |
| 5 | Live agent catalog refresh for a running session | 1.x | "Refresh agents" would also reload project-defined agents; today the session list (`session_agents`) updates only when the runtime starts | Needs a runtime resource-reload call on both clients | open |
