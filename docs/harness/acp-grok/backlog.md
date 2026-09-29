# Grok (ACP) backlog

These entries preserve unimplemented work from the design notes. Upstream
introduction versions are unknown; Grok's user-installed runtime is not pinned.
Recheck the actual runtime surface before adopting an item.

| Capability | Introduced | Benefit | Cost / risk | Decision |
|---|---|---|---|---|
| Plan filename and structured review feedback | Unknown | Better plan review | Current adapter has no plan-file field; do not invent response fields | open; verify upstream shape first |
| Mobile line-level plan comments | Unknown | Desktop/phone review parity | Native interaction and response routing | open |
| Node interjection self-echo suppression | Unknown | Avoid duplicate user messages | Shared mapper lacks desktop's self-ID filter; node has no equivalent live steering control | open; implement with node steering |
| Node session controls and initialize parity | Unknown | Consistent permission, model and MCP controls | Empty capabilities/version placeholder and headless approval constraints | open |
| `x.ai/session/prompt_complete` | Unknown | Alternate completion rail | Duplicate terminal events; durable `turn_completed` already handled | open; require a failure the existing rail cannot cover |
| `x.ai/hooks/run` | Unknown | Host hook execution | Reverse-RPC execution/permission contract | open |
| `x.ai/queue/*` | Unknown | Agent-owned queue controls | Reconcile with host queue, interject and send-now | open |
| Grok TOML MCP catalog | Unknown | Show agent-configured servers | Separate configuration ownership; schema may differ by binary | open |
| User MCP session-ID header substitution and timeouts | Unknown | Session-aware servers and predictable startup | ACP descriptor support must be checked | open |
| `x.ai/mcp/sdk_call` | Unknown | In-process MCP transport | Host already uses HTTP/stdio; additional transport lifecycle | open |
| ACP `session/resume` | Unknown | Additional resume path | Existing load/new lifecycle covers current use | open; no current adoption |
| `acceptEdits` / `dontAsk` | Unknown | More permission modes | Yolo notification has no distinct mapping | open; never expose unsupported controls |
| Spoof Grok Desktop client identity | Unknown | Access to richer agent-side permission options | Claims UI/behavior SuperOne does not implement | rejected; retain Generic identity and Auto explanation |
| Pager/leader-specific chrome and Grok host filesystem delegation | Unknown | Upstream UI parity | Product-specific surfaces; text delegation corrupts binary reads | rejected for current integration |

Ask create-time booleans, plan-entry error propagation, MCP login, selected-server
reconnect, send-now steering and slash-workflow cards are implemented. They are
contracts in the sibling docs, not pending work.
