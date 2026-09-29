# Claude Agent SDK backlog

Unused upstream capabilities and gaps, and the decision on each. Decisions:
`open`, `adopt` (link the upgrade doc that lands it), `rejected` (keep the
reason). Ledger rows: [api-surface.md](api-surface.md).

## Capabilities

| # | Capability | Since | Benefit | Cost / risk | Decision |
|---|---|---|---|---|---|
| 1 | `system/informational` messages | 0.3.283 (sent during turns) | Shows warnings and notices the CLI raises mid-turn, such as a UserPromptSubmit hook's block reason; both mappers drop them today | Needs a chat row style per `level`; both mappers change | open |
| 2 | `plugin_errors` on `system/init` | 0.3.283 | Explains why a plugin did not load instead of it silently missing | Small; needs a place in plugin settings or an init notice | open |
| 3 | `./core` entry point | 0.3.282 | Smaller SDK load in the main process | Must confirm it covers `startup`, `forkSession`, `getSubagentMessages`; uses our installed zod and MCP SDK | open |
| 4 | `prewarm()` / `SpareProcess.claim()` | 0.3.282 (alpha) | Warm a process before cwd is known; could replace `WarmupManager.keyOf`'s hand-kept list | Alpha API; `ClaimOptions` covers only some options, so the keyed pool stays for the rest | open, wait for stable |
| 5 | `canUseTool` `options.mcpServer.source === 'sdk'` | ≤0.3.278 | Trust SuperOne tools by origin instead of the `mcp__superone__` name prefix | `allowedTools` admission still matches by name | open |
| 6 | `result.startup_failure_reason` | ≤0.3.278 | Specific error UI for startup failures (17 reasons) instead of generic text | Mapping table in `result-failure.ts` | open |
| 7 | `conversation_reset` | 0.3.281 (fields) | Follow `/clear` and plan-exit resets to the new conversation id and reset the title | Needs a session-level transcript switch | open |
| 8 | `system/permission_denied` | — | Live notice when a tool is auto-denied, instead of reading `result.permission_denials` after the turn | Low value while denials already show at turn end | open |
| 9 | `system/memory_recall`, `system/thinking_tokens` | — | Recalled-memory row; live thinking-token estimate | Cosmetic | open |
| 10 | `readMcpResource()` | 0.3.280 | Fetch MCP Apps `ui://` resources from CLI-dialed servers | MCP Apps are not being pursued | rejected: MCP Apps paused |
| 11 | `thinking.display: 'highlights'` | ≤0.3.278 | Highlighted thinking | Only works on Anthropic-hosted models; third-party providers get nothing | rejected |
| 12 | `usage_EXPERIMENTAL_…()` | ≤0.3.278 | Structured `/usage` data | Marked experimental; `claude-usage-service` already covers plan usage | rejected |

## Integration gaps

Places where SuperOne uses an interface in one runtime but not another, or
declares less than upstream offers.

| # | Gap | Effect | Decision |
|---|---|---|---|
| G1 | Remote node registers no `hooks` | `denySubagentSessionRename` does not run on remote nodes, so a subagent can call main-thread-only SuperOne tools there | open |
| G2 | Remote node sets no `onElicitation` | MCP elicitations on remote nodes are auto-declined | open |
| G3 | Remote node does not forward `skipTranscript` / `isBackgrounded` / `spawnDepth` on `task_started` | Background and nested subagents render differently from desktop | open |
| G4 | Shared `HookEventName` lacks `DirectoryAdded`, `MessageDisplay`, `PreModelSwitch`, `PostModelSwitch` | The settings.json hook editor cannot offer those events | open |
