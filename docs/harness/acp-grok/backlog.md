# Grok (ACP) backlog

These entries preserve unimplemented work from the design notes. Upstream
introduction versions are unknown; Grok's user-installed runtime is not pinned.
Recheck the actual runtime surface before adopting an item.

| Capability | Introduced | Benefit | Cost / risk | Decision |
|---|---|---|---|---|
| Permission chip commits only after the Grok RPC | Unknown | Selector matches the agent | Chip and `permission_mode_change` commit after `session/set_mode` or `yolo_mode_changed`. Create-time plan rolls back to `default` when `set_mode` fails. Leaving plan also requires `set_mode` `default` before the yolo notification. A yolo notification failure is a local send error | done in 1.0.45+2bdd1d6a |
| `session/load` `_meta.noReplay` | Unknown | Resume does not treat replay as live traffic | Desktop grok-build load sets `noReplay: true`. `drainLoadReplay` stays as a backstop and keeps its pending read for the pump. `session/resume` was not added | done in 1.0.45+2bdd1d6a |
| Folder trust prompt | Unknown | Project rules, MCP, hooks and skills load after an explicit choice | Desktop advertises `x.ai/folderTrust.interactive` only for grok-build when a dialog handler is wired. Outcome `trust` is the only grant. Host project-scope MCP is withheld until that grant, including later reload, toggle, and reconnect, then attached with `update_mcp_servers`. Timeout and any other outcome reject. The host does not write `trusted_folders.toml` | done in 1.0.45+2bdd1d6a |
| Fork and detect use the chat grok binary | Unknown | Picker, fork and chat launch the same executable | Fork and detect use `resolveDesktopGrokLaunch`. Detect still uses `which` when that resolver has no command | done in 1.0.45+2bdd1d6a |
| Per-tool Generic Auto deny | Unknown | A classifier deny is visible on that tool | A failed result shaped as `Tool \`name\` was not executed: Auto mode blocked this action` is a deny. A successful result that only quotes that sentence is not. `acp-auto-honesty.ts` stays a one-time toast. Client identity is not spoofed | done in 1.0.45+2bdd1d6a |
| Plan filename and structured review feedback | Unknown | Better plan review | Current adapter has no plan-file field; do not invent response fields | open; verify upstream shape first |
| Mobile line-level plan comments | Unknown | Desktop/phone review parity | Native interaction and response routing | open |
| Node interjection self-echo suppression | Unknown | Avoid duplicate user messages | Shared mapper lacks desktop's self-ID filter; node has no equivalent live steering control | open; implement with node steering |
| Node session controls and initialize parity | Unknown | Consistent permission, model and MCP controls | Grok production launch uses the harness binary (`agent stdio`) read on each ACP turn. Initialize sends `resolveCliReleaseVersion()`, host fs/terminal off, and explicit yolo/auto booleans, and authenticates before `session/new` when a noninteractive method exists. A resident node session is still absent | open; do not treat initialize parity as a resident session |
| `x.ai/session/prompt_complete` | Unknown | Alternate completion rail | Duplicate terminal events; durable `turn_completed` already handled | open; require a failure the existing rail cannot cover |
| `x.ai/hooks/run` | Unknown | Host hook execution | Reverse-RPC execution/permission contract | open |
| `x.ai/queue/*` | Unknown | Agent-owned queue controls | Reconcile with host queue, interject and send-now | open |
| Grok TOML MCP catalog | Unknown | Show agent-configured servers | Separate configuration ownership; schema may differ by binary | open |
| User MCP session-ID header substitution and timeouts | Unknown | Session-aware servers and predictable startup | ACP descriptor support must be checked | open |
| `x.ai/mcp/sdk_call` | Unknown | In-process MCP transport | Host already uses HTTP/stdio; additional transport lifecycle | open |
| ACP `session/resume` | Unknown | Additional resume path | Existing load/new lifecycle covers current use | open; no current adoption |
| `acceptEdits` / `dontAsk` | Unknown | More permission modes | Yolo notification has no distinct mapping | open; never expose unsupported controls |
| Context window on `session/set_model` | 1.0.44 | Pick a listed window without changing the model | Omission preserves. An invalid window is `invalid_params` and is not retried. It is not sent on `session/set_config_option`. The picker appears only when the model lists more than one window. `contextWindows` survives the configOptions merge and the cache | done in 1.0.45+2bdd1d6a |
| MCP `_meta["x.ai/mcp/bearerTokenFile"]` | 1.0.45 | Rotate an HTTP MCP token without inlining the secret | Absolute or `~/` path on HTTP/SSE servers. A relative path is sent as written so the agent rejects it. Not a substitute for the Grok TOML catalog | done in 1.0.45+2bdd1d6a |
| Spoof Grok Desktop client identity | Unknown | Access to richer agent-side permission options | Claims UI/behavior SuperOne does not implement | rejected; retain Generic identity and Auto explanation |
| Pager/leader-specific chrome and Grok host filesystem delegation | Unknown | Upstream UI parity | Product-specific surfaces; text delegation corrupts binary reads | rejected for current integration |

Ask create-time booleans, MCP login, selected-server reconnect, send-now
steering, slash-workflow cards, the permission-chip transaction, load
`noReplay`, folder trust, fork/detect launch, Generic Auto tool denies, node
Grok launch and initialize, context window, and MCP bearer token files are
implemented. They are contracts in the sibling docs, not pending work. A
resident node session is still the node-controls row. Reasoning effort is the
`reasoning_effort` config option in `contracts.md`, not an open item.
