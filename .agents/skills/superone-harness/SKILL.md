---
name: superone-harness
description: Add a coding-agent harness or close a harness integration gap in events, capabilities, or host tools. Excludes ordinary UI fixes and API credential configuration.
---

# Harness integration

Translate provider protocols into `AgentEvent` and declare support through shared
capability data. Use existing chat surfaces rather than building a UI per harness.
If a provider already speaks ACP, add its agent id before considering a new harness.

## Read for the task

| Task | Reference |
|---|---|
| New harness | [new-harness.md](references/new-harness.md) and the completeness standard in [integration.md](references/integration.md) |
| One missing capability | The corresponding row in [experiences.md](references/experiences.md) |
| Missing or incorrect chat events | [event-contract.md](references/event-contract.md) |
| Host MCP injection or permission admission | Host SuperOne tools in [integration.md](references/integration.md) |
| Whole-harness audit | Completeness standard and recurring traps in [integration.md](references/integration.md) |

Use Claude, Codex, and Grok as reference implementations for the matching runtime
shape. For a single capability fix, verify that capability's affected surfaces;
do not turn it into an unrelated whole-harness migration.

`HarnessResourcesMap` and `SessionBackend` catch some missing wiring at compile
time. UI catalogs and default branches need inspection for the changed capability.
Set capability flags only when the corresponding events and controls work; leave
unsupported features explicitly off. Preserve exact-name host tool admission and
executor-side authorization as separate layers.

Finish with the requested behavior working, affected checks passing, and any
unverified live or remote paths stated clearly. A new harness needs the full
completeness standard; a narrow fix needs the relevant row.
