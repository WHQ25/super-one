# superone.db — Local SQLite Database

Each mini-app gets private SQLite databases managed by the host. Use this for **app state, user preferences, local caches, and offline data**. No `permissions` declaration is required, and two mini-apps cannot read each other's databases. The DB location is **decoupled from where the app is installed** — it only depends on the scope you pick.

## Two scopes — pick per call

| Accessor | Scope | File | Use for |
|---|---|---|---|
| `superone.db` / `superone.db.project` | **Project** (default) | `<repoRoot>/.superone/apps/<appId>/data/main.db` | Data tied to the current project/repo |
| `superone.db.user` | **User** (machine-wide) | `~/.superone/apps/<appId>/data/main.db` | Data shared across every project (cross-project linkage) |

```js
// Project-scoped (default) — per-repo data
await superone.db.exec('INSERT INTO tasks (title) VALUES (?)', ['ship it'])

// User-scoped — same DB no matter which project is open
await superone.db.user.exec('INSERT INTO recents (path) VALUES (?)', [p])
```

- **Default is project scope.** Bare `superone.db.*` === `superone.db.project.*`.
- **Project scope follows the git repo, not the folder.** All git worktrees of the same repo resolve to the repo root, so a worktree sees the **same** project DB as the main checkout.
- **Project scope throws when no project is open.** If the app might run without a project, use `superone.db.user` (always available) or guard the call.
- `superone.kv` mirrors this exactly: `kv` / `kv.project` (default, per-repo) and `kv.user` (machine-wide).

## When to use local DB vs remote DB

Pick **local DB (this API)** when ALL of these are true:
- Data is per-user, per-machine — no cross-device sync
- No multi-user collaboration
- Single-app data ownership — no other app needs to read it

Pick a **remote DB** (Supabase, Turso, PlanetScale, Firestore — any HTTPS DB; declare the domain in `permissions.network` and `fetch()` directly) when ANY of these are true:
- Cross-device sync is required (notes that follow the user)
- Multiple users edit the same data
- Custom SQL functions / aggregates / FTS tokenizers are needed (see "Not supported")
- Streaming / pagination over millions of rows
- Complex transactional logic that doesn't fit a single SQL statement

## Quick start

```js
// Idempotent setup — safe to run on every app load
await superone.db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`)
await superone.db.exec('CREATE INDEX IF NOT EXISTS notes_created ON notes(created_at)')

// Insert
const { lastInsertRowid } = await superone.db.exec(
  'INSERT INTO notes (content, created_at) VALUES (?, ?)',
  ['hello', Date.now()]
)

// Query
const rows = await superone.db.query(
  'SELECT id, content, created_at FROM notes ORDER BY created_at DESC LIMIT 20'
)
```

## API surface

| Method | When to use | Returns |
|---|---|---|
| `db.query(sql, params?)` | `SELECT` | `T[]` of plain row objects |
| `db.exec(sql, params?)` | `INSERT` / `UPDATE` / `DELETE` / DDL | `{ changes, lastInsertRowid }` |
| `db.batch(stmts)` | Multiple writes that must be atomic | `Array<{ changes, lastInsertRowid }>` |
| `db.pragma(name, value?)` | Read or set whitelisted PRAGMAs | depends on pragma |

## Parameter binding

**Always use parameters — never concatenate user input into SQL.**

```js
// Positional
await superone.db.query('SELECT * FROM notes WHERE id = ?', [42])

// Named (@name and :name both work)
await superone.db.query(
  'SELECT * FROM notes WHERE created_at > @since AND tag = @tag',
  { since: Date.now() - 86400000, tag: 'work' }
)
```

## Schema migrations

Use `user_version` to track schema versions:

```js
async function migrate() {
  const [{ user_version: version }] = await superone.db.pragma('user_version')

  if (version < 1) {
    await superone.db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, content TEXT)')
    await superone.db.pragma('user_version', 1)
  }
  if (version < 2) {
    await superone.db.exec('ALTER TABLE notes ADD COLUMN tags TEXT')
    await superone.db.pragma('user_version', 2)
  }
}
await migrate()
```

Set `user_version` via the dedicated `pragma()` call, **not** via `PRAGMA user_version = N` inside `exec` or `batch`.

Allowed PRAGMAs: `journal_mode`, `synchronous`, `user_version`, `foreign_keys`, `cache_size`, `temp_store`, `wal_checkpoint`, `table_info`, `table_list`, `index_list`, `index_info`, `page_count`, `page_size`. Other PRAGMAs are rejected.

## Atomic batches (the substitute for `transaction(fn)`)

`batch()` runs an array of statements inside a single SQLite transaction. All succeed and commit together, or any error rolls everything back.

```js
await superone.db.batch([
  { sql: 'INSERT INTO orders (item, qty) VALUES (?, ?)', params: ['sku-1', 2] },
  { sql: 'UPDATE inventory SET stock = stock - ? WHERE sku = ?', params: [2, 'sku-1'] },
])
```

`db.transaction(fn)` is **not** available — IPC can't run a renderer-side function synchronously inside main process's SQLite call stack. For control flow that depends on intermediate results, push the condition into SQL itself (see "Conditional update" recipe) or do `query` → branch in JS → `batch` (only for non-concurrent code paths).

## Indexing

SQLite is fast on indexed columns and slow on full-table scans. Add an index on:
- Columns used in `WHERE` clauses
- Columns used in `ORDER BY` (especially with `LIMIT`)
- Foreign key columns

```js
await superone.db.exec('CREATE INDEX IF NOT EXISTS notes_user_created ON notes(user_id, created_at)')
```

Composite indexes work left-to-right: `(user_id, created_at)` accelerates queries filtering by `user_id` alone, or by `user_id` AND `created_at`, but **not** by `created_at` alone.

## Verifying queries with EXPLAIN QUERY PLAN

To check whether a query uses indexes, prefix it with `EXPLAIN QUERY PLAN`:

```js
const plan = await superone.db.query(
  'EXPLAIN QUERY PLAN SELECT * FROM notes WHERE user_id = ? ORDER BY created_at DESC',
  [42]
)
console.log(plan)
// Look for "USING INDEX <name>" — good. "SCAN TABLE notes" — bad (full scan).
```

## JS ↔ SQLite type mapping

| JS value | SQLite column | Read back as |
|---|---|---|
| `number` (int) | `INTEGER` | `number` |
| `number` (float) | `REAL` | `number` |
| `string` | `TEXT` | `string` |
| `null` / `undefined` | `NULL` | `null` |
| `Uint8Array` / `ArrayBuffer` | `BLOB` | `Uint8Array` (after IPC) |
| `boolean` | ⚠️ **not native** | — |
| `Date` | ⚠️ **not native** | — |

### Booleans

SQLite has no boolean type. Convert explicitly:

```js
// Store
await superone.db.exec('INSERT INTO tasks (done) VALUES (?)', [task.done ? 1 : 0])

// Query — column comes back as 0 or 1 number, convert if needed
const rows = await superone.db.query('SELECT done FROM tasks WHERE id = ?', [id])
const done = !!rows[0].done
```

### Dates

Two valid patterns — pick one and be consistent within an app:

```js
// Pattern A: epoch milliseconds (recommended — easy to compare/sort, smaller index)
'created_at INTEGER NOT NULL'   // store: Date.now()    read: new Date(row.created_at)

// Pattern B: ISO 8601 string (human-readable in sqlite3 CLI, slightly slower comparisons)
'created_at TEXT NOT NULL'      // store: new Date().toISOString()    read: new Date(row.created_at)
```

### JSON columns

For semi-structured fields, store JSON as TEXT and parse in JS:

```js
await superone.db.exec(
  'INSERT INTO documents (id, meta) VALUES (?, ?)',
  [docId, JSON.stringify({ tags: ['todo', 'urgent'], priority: 3 })]
)

const [row] = await superone.db.query('SELECT meta FROM documents WHERE id = ?', [docId])
const meta = JSON.parse(row.meta)
```

SQLite has built-in JSON functions (`json_extract`, `json_array`, etc.) you can use in WHERE clauses:

```js
await superone.db.query(
  "SELECT * FROM documents WHERE json_extract(meta, '$.priority') > ?",
  [2]
)
```

## Error handling

Errors from `query` / `exec` / `batch` reject the Promise with an `Error` whose `message` contains the SQLite error.

| Error message contains | Meaning | Typical handling |
|---|---|---|
| `UNIQUE constraint failed` | Inserted a duplicate value into a UNIQUE column | Show "already exists" in UI |
| `FOREIGN KEY constraint failed` | Referenced a non-existent parent row | Validate parent ID before insert |
| `NOT NULL constraint failed` | Missing required column | Form validation |
| `no such table` | Table doesn't exist (skipped migration?) | Re-run migration |
| `no such column` | Column doesn't exist (schema mismatch) | Check version and migrate |
| `forbidden` | App tried `ATTACH`/`DETACH`/`LOAD_EXTENSION` | Remove the keyword |

```js
try {
  await superone.db.exec('INSERT INTO users (email) VALUES (?)', [email])
} catch (err) {
  if (err.message.includes('UNIQUE constraint failed')) {
    superone.ui.toast('That email is already registered', 'error')
  } else {
    superone.ui.toast('Failed: ' + err.message, 'error')
  }
}
```

## Persistence semantics

| Action | Does DB survive? |
|---|---|
| Mini-app close and reopen | ✅ |
| SuperOne quit and restart | ✅ |
| Mini-app rebuild (dev mode) | ✅ |
| `.s1app` upgrade install (drag-drop newer version) | ✅ |
| Mini-app uninstall (user-scope DB) | ❌ deleted |
| Switching to a worktree of the same repo | ✅ same project DB |
| Opening a different project | project DB switches; user DB unchanged |

The DB lives outside the app's installed assets, so reinstalling or upgrading the app never touches your data. A project-scope DB persists in the repo's `.superone/apps/<appId>/data/` (add it to `.gitignore` — it is local runtime data, not source).

## Concurrency model

Each mini-app's DB is accessed only by that mini-app's iframe (single-process, single-writer). You **don't** need:
- Retry logic for `SQLITE_BUSY`
- Locking primitives
- Connection pooling

Multiple concurrent `db.query` / `db.exec` calls from the same app are serialized inside main process automatically — no race conditions on the JS side.

## What is NOT supported (and why)

These are unavailable for **structural** reasons (cross-process IPC limits), not policy:

| API | Why unavailable |
|---|---|
| `db.transaction(fn)` | `fn` lives in iframe; SQLite calls it synchronously inside main; cross-process sync = deadlock. **Use `batch()`.** |
| `db.function(name, fn)` (custom UDF) | Same reason as transaction(fn). |
| `db.aggregate(name, ...)` | Same. |
| `db.table(name, ...)` (custom virtual table) | Same. |
| Custom FTS5 tokenizer | Same — tokenizer is a JS callback. |
| `Statement.iterate()` (cursor) | Would need a stateful cursor session protocol — not built. **Use `LIMIT/OFFSET` pagination.** |
| `db.loadExtension()` | Loads native code — defeats sandbox. |
| `ATTACH DATABASE` / `DETACH DATABASE` | Could read another app's DB. |
| Custom DB file path | Host picks the path; you only choose the scope (`db` vs `db.user`). |

If you need any of these, the right answer is a remote DB — local SQLite is the wrong tool.

## Recipes

### KV-style state

```js
await superone.db.exec(`
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)
`)

async function getKv(key) {
  const rows = await superone.db.query('SELECT value FROM kv WHERE key = ?', [key])
  return rows[0]?.value ?? null
}

async function setKv(key, value) {
  await superone.db.exec(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  )
}
```

### Paginated list

```js
async function listNotes(page, pageSize) {
  return superone.db.query(
    'SELECT id, content, created_at FROM notes ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    [pageSize, page * pageSize]
  )
}
```

The secondary `ORDER BY id DESC` ensures stable ordering when multiple rows share the same `created_at`.

### Cursor-style infinite scroll (better than OFFSET for large tables)

OFFSET gets slow on big tables (SQLite must scan and discard the skipped rows). For infinite scroll, paginate by the last-seen cursor:

```js
async function loadMoreNotes(lastCreatedAt, pageSize) {
  return superone.db.query(
    'SELECT id, content, created_at FROM notes WHERE created_at < ? ORDER BY created_at DESC LIMIT ?',
    [lastCreatedAt ?? Number.MAX_SAFE_INTEGER, pageSize]
  )
}
```

### Conditional update — express the condition in SQL

Don't try to "check then act" in two calls — race-prone. Push the condition into the SQL itself:

```js
const result = await superone.db.exec(
  `UPDATE accounts
     SET balance = balance + (CASE WHEN id = @from THEN -@amount ELSE @amount END)
     WHERE id IN (@from, @to)
       AND (SELECT balance FROM accounts WHERE id = @from) >= @amount`,
  { from: 1, to: 2, amount: 100 }
)
if (result.changes === 0) throw new Error('insufficient balance')
```

### Parent + children with foreign keys (kanban-style)

```js
await superone.db.batch([
  { sql: `CREATE TABLE IF NOT EXISTS lists (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            position INTEGER NOT NULL
          )` },
  { sql: `CREATE TABLE IF NOT EXISTS cards (
            id INTEGER PRIMARY KEY,
            list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            position INTEGER NOT NULL
          )` },
  { sql: 'CREATE INDEX IF NOT EXISTS cards_list ON cards(list_id, position)' },
])
```

`foreign_keys` is enabled by default — `ON DELETE CASCADE` will actually fire.

### Full-text search (built-in FTS5)

SQLite ships with FTS5 — works out of the box. Custom tokenizers don't (see "Not supported").

```js
await superone.db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
    USING fts5(content, content='notes', content_rowid='id')
`)
// keep FTS in sync via triggers, or rebuild periodically:
await superone.db.exec(`INSERT INTO notes_fts(notes_fts) VALUES ('rebuild')`)

const hits = await superone.db.query(
  'SELECT id, content FROM notes WHERE id IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?) LIMIT 50',
  [searchTerm]
)
```

For Chinese/Japanese/Korean text, FTS5's default tokenizer splits poorly — pre-tokenize on the JS side and store the tokenized form in a separate column, OR fall back to `LIKE '%...%'` (slow on large tables).

### Reset all app state

```js
await superone.db.batch([
  { sql: 'DELETE FROM notes' },
  { sql: 'DELETE FROM tags' },
  { sql: 'DELETE FROM kv' },
])
```

To reset auto-increment IDs as well:

```js
await superone.db.exec("DELETE FROM sqlite_sequence WHERE name IN ('notes', 'tags')")
```

## Inspecting the DB during development

Each scope is a real SQLite file:

```
~/.superone/apps/<appId>/data/main.db              # superone.db.user
<repoRoot>/.superone/apps/<appId>/data/main.db     # superone.db (project, shared across worktrees)
```

Open it from a terminal:

```bash
sqlite3 ~/.superone/apps/your-app/data/main.db
> .tables
> .schema notes
> SELECT * FROM notes LIMIT 10;
```

## TypeScript types

```ts
interface SuperOneDbRunResult {
  changes: number
  lastInsertRowid: number
}

interface SuperOneDbStatement {
  sql: string
  params?: unknown[] | Record<string, unknown>
}

interface SuperOneDb {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[] | Record<string, unknown>,
  ): Promise<T[]>
  exec(
    sql: string,
    params?: unknown[] | Record<string, unknown>,
  ): Promise<SuperOneDbRunResult>
  batch(statements: SuperOneDbStatement[]): Promise<SuperOneDbRunResult[]>
  pragma<T = unknown>(name: string, value?: string | number): Promise<T>
}

// `superone.db` is the project-scoped instance, with explicit accessors:
//   superone.db          → project (default)
//   superone.db.project  → project (explicit)
//   superone.db.user     → machine-wide
type SuperOneDbApi = SuperOneDb & { project: SuperOneDb; user: SuperOneDb }
```
