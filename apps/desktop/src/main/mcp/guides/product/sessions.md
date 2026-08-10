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
session_read({ sessionId, view: "user", limit: 20 })
session_read({ sessionId, view: "assistant", messageId, around: 1 })
```

### Cross-harness content handoff

```
session_list({ harness: "codex", limit: 10 })
session_read({ sessionId, view: "user", limit: 20 })
session_read({ sessionId, view: "assistant", limit: 10 })
// continue in the current session — do not resume the other harness thread
```

### List order (fewer tool calls)

`order` (default `last_active_desc`):

| value | Use when |
|-------|----------|
| `last_active_desc` | Recent work first (default) |
| `last_active_asc` | Oldest first — cleanup / archive |
| `created_desc` / `created_asc` | By session creation time |
| `message_count_desc` / `message_count_asc` | Heaviest or emptiest transcripts |
| `size_desc` / `size_asc` | By approx stored size; rows include `sizeBytes` |

```
session_list({ order: "last_active_asc", limit: 50 })
session_list({ order: "message_count_asc", limit: 20 })  // empty / stub sessions
session_list({ order: "size_desc", limit: 20 })          // largest transcripts first
```

`sizeBytes` is only included when `order` is `size_*`. It is a ranking metric (SQLite `LENGTH` on TEXT = character lengths of `content_json` + `metadata_json`), not disk page-file bytes. Default list order skips the size subquery for speed.

### What files did that turn touch?

```
session_read({ sessionId, view: "tools", messageId: "<assistant-msg-id>" })
session_read({ sessionId, view: "tool_detail", toolUseId: "..." })  // only if needed
```

### Cleanup

```
session_list({ order: "last_active_asc", limit: 50 })   // discover first
session_cleanup({ action: "hide", sessionIds: [...] })  // soft, no confirm
session_cleanup({ action: "delete", sessionIds: [...] }) // host confirmation dialog only
```

Safety: never deletes the **current** session; **pinned** sessions are skipped unless `includePinned: true`. `delete` always requires a user confirmation dialog (no separate preview step).

## Scope

- Default: **current project only**.
- Hidden sessions are omitted from list/search unless you opt in (`includeHidden` on list).
