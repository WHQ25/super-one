/**
 * Export the events each recording's sessions emitted (`agent.emit`, before any
 * subscriber pipeline) as the input of the stream profile golden tests.
 *
 *   bun scripts/export-stream-fixtures.ts [recordingsDir] [output]
 */
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const recordingsDir = resolve(process.argv[2] ?? join(here, 'recordings'))
const output = resolve(process.argv[3] ?? join(here, '../src/main/stream/fixtures/emitted.generated.json'))
const names = ['permission-flow', 'claude-todos', 'queued-mid-turn', 'queued-interrupt', 'mermaid-latex']

function query<T>(database: string, sql: string): T[] {
  const result = Bun.spawnSync(['sqlite3', '-json', database, sql])
  if (!result.success) throw new Error(result.stderr.toString() || `sqlite3 exited ${result.exitCode}`)
  const text = result.stdout.toString().trim()
  return text ? JSON.parse(text) as T[] : []
}

const scenarios: Array<{ recording: string; events: unknown[] }> = []
for (const name of names) {
  const path = join(recordingsDir, `${name}.db`)
  if (!existsSync(path)) throw new Error(`missing recording ${path}`)
  const rows = query<{ data: string }>(path, "SELECT data FROM events WHERE source = 'agent.emit' ORDER BY id")
  scenarios.push({ recording: name, events: rows.map((row) => JSON.parse(row.data)) })
}
writeFileSync(output, `${JSON.stringify(scenarios)}\n`)
console.log(`wrote ${scenarios.map((s) => `${s.recording}:${s.events.length}`).join(' ')} → ${output}`)
