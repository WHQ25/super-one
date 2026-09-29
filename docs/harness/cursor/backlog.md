# Cursor SDK backlog

| Capability | Since | Benefit | Cost / risk | Decision |
|---|---|---|---|---|
| Complete versioned API ledger | Initial integration | Account for every public interface | Old qualitative matrix is not a current inventory | open; ledger remains explicitly not started |
| True transcript fork / file rewind | Initial integration | Continue provider history and restore files | Current fork creates a blank provider agent; no host rewind API | open; capabilities remain off |
| Queued steering, manual compaction, multiple roots and goals | Initial integration | Cross-harness parity | Need actual SDK controls and coherent host lifecycle | open; flags remain off |
| Dedicated cloud-management UI | Initial integration | Expose more existing host APIs | Local/cloud support and billing differ | open; API helpers alone are not complete UI |
| Utility-process isolation | Initial integration | Reduce host-process coupling | Extra transport/lifetime machinery | open; justify with measured runtime problems |
| Unified logout semantics | SDK browser-login integration | Make removal of credentials explicit | SDK auth store and vault copy have separate lifetimes | open; decide whether logout also clears the provider key |
| Redistribution review record | Original design D10 | Preserve the decision behind distribution | Original design requested review; outcome is not established by packaging code | open evidence item; no legal conclusion in this document |
| Private SDK executors/tailers/conversion helpers | Initial integration | Lower-level access | Internal coupling duplicates public facade | rejected as the default integration path |
| Additional SQLite/JSONL product stores | Initial integration | Alternative storage | Another persistence/native stack | rejected as product default; retain better-sqlite3 |
| IDE token scraping / login proxy | Initial integration | Reuse unrelated auth state | Unsupported credential boundary | rejected; use key or SDK browser login |
| Cursor CLI or ACP as the primary harness | Initial integration | Alternative process boundary | Replaces working SDK/store integration | rejected for current architecture |

Project+user settings, browser login, local custom question tools, MCP host
injection and model-window-aware context usage are implemented contracts, not
open questions from the initial design.
