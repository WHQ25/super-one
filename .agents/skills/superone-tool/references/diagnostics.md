# Tool integration diagnostics

Use the observed failing surface to choose a check.

| Symptom | Look at |
|---|---|
| Model never calls it (Claude) | Description / Zod registration (surfaces 3) / `alwaysLoad` |
| Works in Claude, invisible in Codex / Grok | JSON-Schema def (surface 2) or host MCP not injected (`superone-harness`) |
| Codex permission-prompts every call | Bare name missing from `STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES` |
| Grok row is generic `use tool` | ACP event map did not unwrap `superone__bare` → `mcp__superone__bare` |
| Allow on Grok hangs until timeout | Confirm resolved in a backend, not `Session.respondToPermission` |
| Subagent renamed/tagged the parent chat | Main-thread-only deny missing on that harness |
| Desktop row fine, phone blank | Mobile strip allowlist / `toolSummary` |
| Designed Storybook, generic row in chat | `ToolBlock` branch keys `mcpInfo.mcpToolName` (bare); name never parsed |

