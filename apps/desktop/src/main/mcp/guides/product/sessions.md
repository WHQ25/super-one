# SuperOne session archive (`session_list` / `session_search` / `session_read` / `session_cleanup`)

Read saved SuperOne chat transcripts across harnesses (Claude, Codex, ACP, OpenCode). This is **content-level** access to the host’s SQLite archive — not live collab, not provider-thread resume.

## What this is (and is not)

| Goal | Tool path | Not this |
|------|-----------|----------|
| Cite / handoff / continue under another harness | `session_search` → `session_read` | `provider_session_id` resume |
| Live parallel agents | `session_collab_*` | archive tools |
| Branch a conversation in the same harness | UI fork | archive tools |

## Views (`session_read`)

| view | Content |
|------|---------|
| `meta` | Title, harness, counts, pin/hidden, branch, cost |
| `user` | **User messages only** (full text, no tools) |
| `assistant` | **Assistant text only** + `toolCount` (no tool lines) |
| `text` | Interleaved user + assistant text (still no tool lines) |
| `tools` | Tool **index** (name, path/target, toolUseId) — prefer with `messageId` |
| `tool_detail` | One tool’s input/result (`toolUseId` required) |

Overload control is **view + `limit`/`cursor` (and optional `messageId`/`around`)**, not mid-message truncation.

## Recipes

### Cite / recover a prior decision

```
session_search({ query: "auth refresh" })
session_read({ sessionId, view: "user", limit: 30 })
session_read({ sessionId, view: "assistant", messageId, around: 1 })
```

### Cross-harness content handoff

```
session_list({ harness: "codex", limit: 10 })
session_read({ sessionId, view: "user", limit: 40 })
session_read({ sessionId, view: "assistant", limit: 10 })
// continue in the current session — do not resume the other harness thread
```

### What files did that turn touch?

```
session_read({ sessionId, view: "tools", messageId: "<assistant-msg-id>" })
session_read({ sessionId, view: "tool_detail", toolUseId: "..." })  // only if needed
```

### Cleanup

```
session_cleanup({ action: "preview", olderThan: "2026-01-01T00:00:00.000Z" })
// review candidates + confirmToken
session_cleanup({ action: "hide", sessionIds: [...] })           // soft
session_cleanup({ action: "delete", sessionIds: [...], confirmToken })  // user must approve
```

Safety: never deletes the **current** session; **pinned** sessions are skipped unless `includePinned: true`. Delete requires preview `confirmToken` and a host confirmation dialog.

## Scope

- Default: **current project only**.
- Hidden sessions are omitted from list/search unless you opt in (`includeHidden` on list).
