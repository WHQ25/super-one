# Cursor SDK backlog

| Capability | Since | Benefit | Cost / risk | Decision |
|---|---|---|---|---|
| Complete versioned API ledger | Initial integration | Account for every public interface | `1.3.1` ledger lists only the symbols that bump uses or explicitly skips. The inventory script has no Cursor extractor | open; partial ledger in [api-surface.md](api-surface.md) |
| True transcript fork / file rewind | Initial integration | Continue provider history and restore files | `1.3.1` still has no fork or rewind method. The adapter creates a blank provider agent | open; `supportsFork` stays false and `rewindFiles` stays unsupported |
| Goals | Initial integration | Cross-harness goal control | No Cursor goal API is wired | open; `goal` stays null |
| `AgentOptions.systemPrompt` | by 1.0.31 | Replace the harness prompt | It replaces Cursor's built-in prompt, is account-gated, and is not stored on resume | rejected for host context; the first user message still carries it |
| `local.fs` and tree helpers | 1.1.0 | Run file tools on an in-memory tree | Product sessions use the host disk | open; not passed |
| `AgentOptions.teamId` | 1.3.1 types | Pin a multi-team login | Not persisted by the SDK; single-team logins omit it | open; header stays off |
| No-repo cloud agents | 1.3.1 README | Cloud VM with `repos: []` | Account-gated, and repository-scoped keys cannot create them | open; not created |
| Manual compaction, queued steering, additional directories | 1.2.0 / by 1.0.31 / 1.0.30 | Desktop local parity | Cloud cannot summarize or take extra roots. Node one-shot turns do not steer, compact, or take extra roots | adopt; landed in [1.3.1](upgrades/1.3.1.md) |
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
