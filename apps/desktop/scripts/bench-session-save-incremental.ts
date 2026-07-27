/**
 * Microbench: full vs incremental message write pattern (bun:sqlite).
 *
 * NOT production-equivalent:
 * - Uses bun:sqlite, not better-sqlite3
 * - Omits session metadata UPSERT and activity_daily paths
 * - Useful only as an order-of-magnitude signal for DELETE-all vs selective upsert
 *
 *   bun apps/desktop/scripts/bench-session-save-incremental.ts
 */
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const dir = mkdtempSync(join(tmpdir(), 'so-save-bench-'))
const db = new Database(join(dir, 'bench.db'))
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA synchronous = NORMAL')
db.exec(`
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  provider_id TEXT,
  metadata_json TEXT,
  checkpoint_id TEXT,
  resume_point_id TEXT,
  usage_counted_at TEXT
);
CREATE INDEX idx ON chat_messages(session_id, sort_order);
`)

const insert = db.prepare(`
INSERT INTO chat_messages (id, session_id, sort_order, role, status, content_json, created_at, provider_id, metadata_json, checkpoint_id, resume_point_id, usage_counted_at)
VALUES ($id, $session_id, $sort_order, $role, $status, $content_json, $created_at, $provider_id, $metadata_json, $checkpoint_id, $resume_point_id, $usage_counted_at)
ON CONFLICT(id) DO UPDATE SET
  sort_order = excluded.sort_order,
  role = excluded.role,
  status = excluded.status,
  content_json = excluded.content_json,
  created_at = excluded.created_at,
  provider_id = excluded.provider_id,
  metadata_json = excluded.metadata_json,
  checkpoint_id = excluded.checkpoint_id,
  resume_point_id = excluded.resume_point_id
`)
const delAll = db.prepare('DELETE FROM chat_messages WHERE session_id = ?')
const delOne = db.prepare('DELETE FROM chat_messages WHERE session_id = ? AND id = ?')
const selectExisting = db.prepare('SELECT id, usage_counted_at FROM chat_messages WHERE session_id = ?')

function makeMsg(i: number, sizeBytes: number) {
  const pad = 'x'.repeat(Math.max(0, sizeBytes - 80))
  return {
    id: `m-${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    status: 'complete',
    content_json: JSON.stringify({ content: [{ type: 'text', text: pad }] }),
    created_at: new Date(Date.now() + i).toISOString(),
    provider_id: 'claude',
    metadata_json: null as string | null,
    checkpoint_id: null as string | null,
    resume_point_id: null as string | null,
    usage_counted_at: null as string | null,
  }
}

type Msg = ReturnType<typeof makeMsg>

function fullRewrite(sessionId: string, messages: Msg[]) {
  const tx = db.transaction(() => {
    delAll.run(sessionId)
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      insert.run({
        $id: m.id, $session_id: sessionId, $sort_order: i, $role: m.role, $status: m.status,
        $content_json: m.content_json, $created_at: m.created_at, $provider_id: m.provider_id,
        $metadata_json: m.metadata_json, $checkpoint_id: m.checkpoint_id,
        $resume_point_id: m.resume_point_id, $usage_counted_at: m.usage_counted_at,
      })
    }
  })
  tx()
}

function incremental(
  sessionId: string,
  messages: Msg[],
  mode: { kind: 'full' } | { kind: 'incremental'; dirty: string[] },
) {
  const tx = db.transaction(() => {
    const existing = selectExisting.all(sessionId) as Array<{ id: string }>
    const existingIds = new Set(existing.map((r) => r.id))
    const memoryIds = new Set(messages.map((m) => m.id))
    for (const id of existingIds) {
      if (!memoryIds.has(id)) delOne.run(sessionId, id)
    }
    const toWrite = new Set<string>()
    if (mode.kind === 'full') {
      for (const id of memoryIds) toWrite.add(id)
    } else {
      for (const id of mode.dirty) if (memoryIds.has(id)) toWrite.add(id)
      for (const id of memoryIds) if (!existingIds.has(id)) toWrite.add(id)
    }
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      if (!toWrite.has(m.id)) continue
      insert.run({
        $id: m.id, $session_id: sessionId, $sort_order: i, $role: m.role, $status: m.status,
        $content_json: m.content_json, $created_at: m.created_at, $provider_id: m.provider_id,
        $metadata_json: m.metadata_json, $checkpoint_id: m.checkpoint_id,
        $resume_point_id: m.resume_point_id, $usage_counted_at: m.usage_counted_at,
      })
    }
  })
  tx()
}

function time(fn: () => void, n = 5) {
  fn()
  const times: number[] = []
  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    fn()
    times.push(performance.now() - t0)
  }
  times.sort((a, b) => a - b)
  return { med: +times[Math.floor(times.length / 2)]!.toFixed(2), min: +times[0]!.toFixed(2), max: +times[times.length - 1]!.toFixed(2) }
}

console.log('=== Production-approx save algorithm bench (bun:sqlite) ===\n')

for (const s of [
  { name: '50x50KB', n: 50, bytes: 50_000 },
  { name: '130x90KB', n: 130, bytes: 90_000 },
  { name: '200x150KB', n: 200, bytes: 150_000 },
]) {
  const sid = s.name
  const messages = Array.from({ length: s.n }, (_, i) => makeMsg(i, s.bytes))
  fullRewrite(sid, messages)
  const next = [...messages, makeMsg(s.n, s.bytes), makeMsg(s.n + 1, s.bytes)]
  const dirty = [`m-${s.n}`, `m-${s.n + 1}`]

  const full = time(() => fullRewrite(sid, next))
  fullRewrite(sid, messages)
  const incr = time(() => incremental(sid, next, { kind: 'incremental', dirty }))

  console.log(`[${s.name}] msgs=${s.n} ~${((s.n * s.bytes) / 1024 / 1024).toFixed(2)}MB`)
  console.log(`  full DELETE+rewrite: med ${full.med}ms`)
  console.log(`  incremental (select+stale+2): med ${incr.med}ms  (${(full.med / Math.max(incr.med, 0.01)).toFixed(0)}x)`)
  console.log('')
}

db.close()
rmSync(dir, { recursive: true, force: true })
