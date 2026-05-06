# superone.db — Local SQLite Database

Each mini-app gets its own SQLite database file managed by the host. Use this for **app state, user preferences, local caches, and offline-capable data**. For complex queries, cross-device sync, or multi-user collaboration, connect directly to a remote database (Supabase, Turso, PlanetScale, Firebase, etc.) — `fetch()` is allowed when you declare the domain in `permissions.network`.

The DB file lives at `<install-slot>/data/main.db` and survives rebuilds and pack/install cycles. Uninstalling the app deletes the DB.

No `permissions` declaration is required for `superone.db` — it always points at the app's own private DB.

## Querying

```js
const rows = await superone.db.query('SELECT * FROM notes ORDER BY id DESC LIMIT 10')
// → Array of plain objects: [{ id: 3, content: '...', created_at: 1700... }, ...]
```

Parameter binding (use this — never concatenate user input into SQL):

```js
// Positional (?)
await superone.db.query('SELECT * FROM notes WHERE id = ?', [42])

// Named (@name or :name)
await superone.db.query(
  'SELECT * FROM notes WHERE created_at > @since',
  { since: Date.now() - 86400000 }
)
```

## Writing

```js
const result = await superone.db.exec(
  'INSERT INTO notes (content, created_at) VALUES (?, ?)',
  ['hello', Date.now()]
)
// → { changes: 1, lastInsertRowid: 1 }
```

`exec` is for any single statement that does not return rows: `INSERT`, `UPDATE`, `DELETE`, `CREATE TABLE`, `CREATE INDEX`, etc.

## Schema setup

```js
await superone.db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`)
await superone.db.exec('CREATE INDEX IF NOT EXISTS notes_created ON notes(created_at)')
```

Run schema setup once near app startup (CREATE IF NOT EXISTS is idempotent).

## Atomic batches (replaces transactions)

`batch()` runs an array of statements inside a single SQLite transaction — all succeed or all roll back.

```js
await superone.db.batch([
  { sql: 'UPDATE accounts SET balance = balance - ? WHERE id = ?', params: [100, 1] },
  { sql: 'UPDATE accounts SET balance = balance + ? WHERE id = ?', params: [100, 2] },
])
// → [{ changes: 1, lastInsertRowid: 0 }, { changes: 1, lastInsertRowid: 0 }]
```

`db.transaction(fn)` is **not** available because the function would have to run synchronously inside main process's SQLite call stack while living in the iframe — physically impossible across processes. Use `batch()` instead, or move conditional logic into SQL itself (`WHERE` constraints, `CASE`, sub-queries).

## Schema migrations with PRAGMA

Use `user_version` to track migrations:

```js
const [{ user_version: version }] = await superone.db.pragma('user_version')

if (version < 1) {
  await superone.db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, content TEXT)')
  await superone.db.pragma('user_version', 1)
}
if (version < 2) {
  await superone.db.exec('ALTER TABLE notes ADD COLUMN tags TEXT')
  await superone.db.pragma('user_version', 2)
}
```

Set `user_version` via the dedicated `pragma()` call rather than mixing `PRAGMA user_version = N` into a `batch()` — the value-form is the supported path; raw `PRAGMA` text in `exec`/`batch` works for some pragmas but not all, and `PRAGMA` strings are not bound parameters.

Allowed PRAGMAs: `journal_mode`, `synchronous`, `user_version`, `foreign_keys`, `cache_size`, `temp_store`, `wal_checkpoint`, `table_info`, `table_list`, `index_list`, `index_info`, `page_count`, `page_size`. Other PRAGMAs are rejected.

## What is NOT supported

The following are **structurally** unavailable in mini-apps (not a policy choice — IPC limits):

- `db.transaction(fn)` — use `batch()`
- Custom SQL functions (`db.function`), aggregates, virtual tables — the JS callback would need to run synchronously inside main process's SQLite call stack
- Custom FTS5 tokenizers — same reason
- Streaming cursors (`stmt.iterate`) — use `LIMIT/OFFSET` pagination
- Loading SQLite extensions (`db.loadExtension`) — security
- `ATTACH DATABASE` / `DETACH DATABASE` — security (would let one app read another's DB)
- Custom DB file paths — host always picks the path under your install slot

If your app genuinely needs custom UDFs, FTS tokenizers, streaming cursors, or 100k+ row analytics, the right answer is **a remote database** (Postgres + Supabase, Turso, etc.), not local SQLite.

## Binary data

`Uint8Array` and `ArrayBuffer` parameters are passed through as SQLite BLOBs:

```js
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47 /* ... */])
await superone.db.exec('INSERT INTO files (name, blob) VALUES (?, ?)', ['logo.png', png])

const [row] = await superone.db.query('SELECT blob FROM files WHERE name = ?', ['logo.png'])
// row.blob is a Uint8Array on the iframe side
```

## Recipes

### Counter / KV-style state

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
    'SELECT * FROM notes ORDER BY id DESC LIMIT ? OFFSET ?',
    [pageSize, page * pageSize]
  )
}
```

### Conditional update — express the condition in SQL itself

`batch` cannot branch on intermediate results, and "compensate after the fact" breaks atomicity. Push the condition into SQL so the whole effect is one atomic statement:

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

For genuinely complex transactional logic (multi-step business rules, cross-table invariants), prefer a remote DB with full transaction support over twisting SQL into a single statement.

## TypeScript Types

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
```
