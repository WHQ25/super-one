# SuperOne session archive (`project_list` / `session_list` / `session_search` / `session_read` / `session_cleanup` / `session_tag` / `session_tag_list`)

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

### Discover tags, then filter

```
session_tag_list()
session_list({ tags: ["oauth", "auth"], tagMatch: "any" })
session_search({ query: "refresh token", tags: ["oauth"], tagMatch: "any" })
session_read({ sessionId, view: "user", limit: 20 })
```

`tagMatch`: `any` = at least one listed tag (default); `all` = every listed tag. Tag filters run in SQL before the text prefilter, so they shrink the scan window. Discover names with `session_tag_list` — do not invent tags. Tag-only lookup is `session_list`, not `session_search` (`query` stays required).

Do not `session_read` the current session — it is already in context.

### Tag while working (main agent only)

```
session_rename({ title: "Fix OAuth refresh", tags: ["oauth", "auth"] })
session_tag({ add: ["desktop"] })                 // current session
session_tag({ sessionIds: ["s1", "s2"], add: ["oauth"] })  // bulk
```

Subagents must not call `session_rename` or `session_tag`. `session_tag_list` / list / search / read are allowed.

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

### Cross-project

```
project_list()                                 // discover projectId (+ name/path once)
project_list({ query: "super-one" })
session_list({ projectId, limit: 20 })         // or allProjects: true
session_search({ query: "oauth", projectId })
session_read({ sessionId })                    // any project by session id
session_cleanup({ action: "hide", sessionIds: [...] })  // ids may span projects
```

Session rows/hits only include `projectId` (not path/name) — call `project_list` when you need human labels.

`session_search` scans the most recent messages in scope, so a wide `allProjects` search can be
bounded by that window rather than by your query. When the result carries `truncated: true`, the
older matches were never scanned — re-run with `projectId`, `sessionIds`, or a more specific query.

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

- **Default**: current project.
- **Discover projects**: `project_list` → `id` / `name` / `path` / `lastActiveAt` (`isCurrent` for the calling session’s project).
- **Cross-project**:
  - `session_list` / `session_search`: `projectId` or `allProjects: true` (rows/hits include `projectId` only).
  - `session_read` / `session_cleanup`: session ids are global — any project. `meta` includes `projectId`.
- Hidden sessions are omitted from list/search unless you opt in (`includeHidden` on list).
