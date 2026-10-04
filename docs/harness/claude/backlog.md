# Claude Agent SDK backlog

Unused upstream capabilities and gaps, and the decision on each. Decisions:
`open`, `adopt` (link the upgrade doc that lands it), `rejected` (keep the
reason). Ledger rows: [api-surface.md](api-surface.md).

## Capabilities

| # | Capability | Since | Benefit | Cost / risk | Decision |
|---|---|---|---|---|---|
| 1 | `system/informational` messages | 0.3.283 (sent during turns) | Shows warnings and notices the CLI raises mid-turn, such as a UserPromptSubmit hook's block reason; both mappers drop them today | Needs a chat row style per `level`; both mappers change | open |
| 2 | `plugin_errors` on `system/init` | 0.3.283 | Explains why a plugin did not load instead of it silently missing | Small; needs a place in plugin settings or an init notice | adopt ([0.3.287](upgrades/0.3.287.md)): transcript error notice. A hooks module that fails to load is not reported there |
| 3 | `./core` entry point | 0.3.282 | Smaller SDK load in the main process | Must confirm it covers `startup`, `forkSession`, `getSubagentMessages`; uses our installed zod and MCP SDK | open |
| 4 | `prewarm()` / `SpareProcess.claim()` | 0.3.282 (alpha) | Warm a process before cwd is known; could replace `WarmupManager.keyOf`'s hand-kept list | Alpha API; `ClaimOptions` covers only some options, so the keyed pool stays for the rest | open, wait for stable |
| 5 | `canUseTool` `options.mcpServer.source === 'sdk'` | ≤0.3.278 | Trust SuperOne tools by origin instead of the `mcp__superone__` name prefix | `allowedTools` admission still matches by name | open |
| 6 | `result.startup_failure_reason` | ≤0.3.278 | Specific error UI for startup failures (17 reasons) instead of generic text | Mapping table in `result-failure.ts` | open |
| 7 | `conversation_reset` | 0.3.281 (fields) | Follow `/clear` and plan-exit resets to the new conversation id and reset the title | Needs a session-level transcript switch | open |
| 8 | `system/permission_denied` | — | Live notice when a tool is auto-denied, instead of reading `result.permission_denials` after the turn | Low value while denials already show at turn end | open |
| 9 | `system/memory_recall`, `system/thinking_tokens` | — | Recalled-memory row; live thinking-token estimate | Cosmetic | open |
| 10 | `thinking.display: 'highlights'` | ≤0.3.278 | Highlighted thinking | Only works on Anthropic-hosted models; third-party providers get nothing | rejected |
| 11 | `usage_EXPERIMENTAL_…()` | ≤0.3.278 | Structured `/usage` data | Marked experimental; `claude-usage-service` already covers plan usage | rejected |
| 12 | Draw mod UI (panes, the band above the prompt) | 0.3.287 (2.1.287) | Mods' panes, controls, transcript rewrites and `Client` parts in SuperOne, as Claude Desktop shows them | Rides an undeclared control protocol through `Query.request` / `setUiHost` (see [contracts](contracts.md#mod-ui-rides-a-private-control-protocol)); an SDK bump can break it silently, so each upgrade replays the recordings | adopt ([features/claude-mods.md](../../features/claude-mods.md)) |
| 14 | `ui_read_selection` mod host request | 0.3.289 (native schema observed) | Lets a mod read the selection on a remote surface | Needs host request mapping and selection capture on desktop and phone | open |
| 13 | `get_task_output` control request | 0.3.287 | Live tail of a background shell or Monitor task without reading its output file | No Query wrapper | open |

## Integration gaps

Places where SuperOne uses an interface in one runtime but not another, or
declares less than upstream offers.

| # | Gap | Effect | Decision |
|---|---|---|---|
| G1 | Remote node registers no `hooks` | `denySubagentSessionRename` does not run on remote nodes, so a subagent can call main-thread-only SuperOne tools there | open |
| G2 | Remote node sets no `onElicitation` | MCP elicitations on remote nodes are auto-declined | open |
| G3 | Remote node does not forward `skipTranscript` / `isBackgrounded` / `spawnDepth` on `task_started` | Background and nested subagents render differently from desktop | open |
| G4 | Shared `HookEventName` lacks `DirectoryAdded`, `MessageDisplay`, `PreModelSwitch`, `PostModelSwitch` | The settings.json hook editor cannot offer those events | open |
| G5 | Mod commands registered `immediate: true` queue behind a running turn | The SDK command list carries no `immediate` flag, so SuperOne cannot tell them from other commands | open, wait for the flag in `initializationResult().commands` |
| G6 | Remote-node composers do not relay `prompt.edit` | A mod's live draft rewrite works only for local desktop sessions; a keystroke per network round trip was judged too costly | open |
| G7 | Mod review and plugin options are local only | The Plugins page shows the hooks review and the `userConfig` form only for this Mac's plugins | open |

SDK 0.3.289 adds an optional opaque `tag` to informational messages (item 1)
and per-model `autoCompactWindow` settings. Both retain their existing handling;
no host UI is added in this upgrade.
