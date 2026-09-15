---
name: superone-tool
description: Design or change SuperOne agent tools, their descriptions, schemas, permissions, or chat ToolBlocks. Use for tool integration and routing failures.
---

# SuperOne tools

Keep the agent-facing contract consistent across desktop and remote registrations,
executor permissions, and chat rendering. For a new capability, first decide
whether it belongs in an existing tool parameter, an on-demand manual topic, or
a distinct action. Prefer a fixed dispatcher for runtime-extensible catalogs.

## Read for the task

| Task | Reference |
|---|---|
| Description, schema, or permission change | [contract.md](references/contract.md) |
| Handler, registration, result encoding, or manual plumbing | [backend.md](references/backend.md) |
| Chat row, ToolBlock, i18n, or mobile presentation | [tool-ui.md](references/tool-ui.md) |
| Tool missing, approval stuck, or wrong harness behavior | [diagnostics.md](references/diagnostics.md), then the relevant contract or backend section |

Read only relevant references. A wording edit does not require UI work or live
launches of every harness. A new tool needs its contract, handler, and presentation.

## Prompt design

Use short, precise triggers and actionable results. Keep description text shared
in `packages/shared/src/superone-tool-descriptions.ts`; desktop and remote field
schemas must agree too. Put conditional workflows in manuals, with pointers on
the tool that needs them. Reuse known ids and loaded guidance. Give the model the
result to achieve and genuine constraints, without prescribing routine reasoning.

## Invariants and completion

- Static host-owned admission uses exact names; it does not authorize the effect.
  Preserve executor confirmation, feature gates, and main-thread-only restrictions.
- Tool names in chat use `mcp__superone__<bare>` across harnesses.
- Results that return handles name their follow-up tool. Cancellation is not a
  signal to retry; completion requires the terminal result.
- For a new or changed tool integration, verify relevant Claude, Codex, and Grok
  paths plus remote parity. New UI needs stories and meaningful state coverage.
- Run the affected contract/handler checks, fix failures caused by the change,
  and report what was verified. Full-suite and live checks should match the scope.
