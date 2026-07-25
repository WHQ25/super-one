import { Database } from 'bun:sqlite'

const DB_PATH = process.argv[2] || 'event-trace.db'
const db = new Database(DB_PATH, { readonly: true })

interface SampleRow {
  id: number
  ts: string
  data: string
}

interface EventRow {
  id: number
  ts: string
  tag: string | null
  data: string
}

interface SampleData {
  mem: { usedMB: number; totalMB: number; limitMB: number } | null
  dom: { nodes: number }
  chat: {
    projects: number
    sessionsTotal: number
    messagesTotal: number
    toolBlocksTotal: number
    activeProject: string | null
  }
  app: { view: string }
  miniapp: { apps: number }
}

const samples = db
  .query<SampleRow, []>(`SELECT id, ts, data FROM events WHERE source='perf.renderer.sample' ORDER BY id`)
  .all()
const events = db
  .query<EventRow, []>(`SELECT id, ts, tag, data FROM events WHERE source='perf.event' ORDER BY id`)
  .all()

if (samples.length === 0) {
  console.error('No perf.renderer.sample events found in', DB_PATH)
  process.exit(1)
}

const parsed = samples.map((s) => ({ id: s.id, ts: s.ts, d: JSON.parse(s.data) as SampleData }))

const first = parsed[0]
const last = parsed[parsed.length - 1]
const peak = parsed.reduce((a, b) => ((b.d.mem?.usedMB ?? 0) > (a.d.mem?.usedMB ?? 0) ? b : a))

console.log('# Perf Report\n')
console.log(`DB: \`${DB_PATH}\``)
console.log(`Samples: ${parsed.length} (${first.ts} → ${last.ts})\n`)

console.log('## Memory Summary\n')
console.log('| Metric | Start | End | Peak | Δ |')
console.log('|---|---|---|---|---|')
if (first.d.mem && last.d.mem && peak.d.mem) {
  const delta = last.d.mem.usedMB - first.d.mem.usedMB
  console.log(`| usedMB | ${first.d.mem.usedMB} | ${last.d.mem.usedMB} | ${peak.d.mem.usedMB} @ ${peak.ts} | ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} |`)
  console.log(`| totalMB | ${first.d.mem.totalMB} | ${last.d.mem.totalMB} | — | — |`)
}
console.log(`| DOM nodes | ${first.d.dom.nodes} | ${last.d.dom.nodes} | — | ${last.d.dom.nodes - first.d.dom.nodes} |`)
console.log(`| Messages | ${first.d.chat.messagesTotal} | ${last.d.chat.messagesTotal} | — | ${last.d.chat.messagesTotal - first.d.chat.messagesTotal} |`)
console.log(`| Tool blocks | ${first.d.chat.toolBlocksTotal} | ${last.d.chat.toolBlocksTotal} | — | ${last.d.chat.toolBlocksTotal - first.d.chat.toolBlocksTotal} |`)
console.log(`| Sessions | ${first.d.chat.sessionsTotal} | ${last.d.chat.sessionsTotal} | — | ${last.d.chat.sessionsTotal - first.d.chat.sessionsTotal} |`)

console.log('\n## Memory Timeline (MB)\n')
const maxMB = Math.max(...parsed.map((p) => p.d.mem?.usedMB ?? 0))
const width = 40
console.log('```')
const step = Math.max(1, Math.ceil(parsed.length / 30))
for (let i = 0; i < parsed.length; i += step) {
  const p = parsed[i]
  const mb = p.d.mem?.usedMB ?? 0
  const bar = '█'.repeat(Math.round((mb / maxMB) * width))
  console.log(`${p.ts}  ${mb.toString().padStart(6)} MB  ${bar}`)
}
console.log('```')

if (events.length > 0) {
  console.log('\n## Events Before/After Memory\n')
  console.log('| Event | Tag | Time | Mem before | Mem after | Δ |')
  console.log('|---|---|---|---|---|---|')
  for (const e of events) {
    const before = parsed.filter((p) => p.id < e.id).pop()
    const after = parsed.find((p) => p.id > e.id)
    if (!before || !after || !before.d.mem || !after.d.mem) continue
    const delta = after.d.mem.usedMB - before.d.mem.usedMB
    const sign = delta > 0 ? '+' : ''
    console.log(`| ${JSON.parse(e.data).from ?? ''} → ${JSON.parse(e.data).to ?? ''} | ${e.tag} | ${e.ts} | ${before.d.mem.usedMB} | ${after.d.mem.usedMB} | ${sign}${delta.toFixed(1)} |`)
  }
}

console.log('\n## Top 5 Memory Growths Between Consecutive Samples\n')
const deltas = parsed.slice(1).map((p, i) => ({
  from: parsed[i],
  to: p,
  delta: (p.d.mem?.usedMB ?? 0) - (parsed[i].d.mem?.usedMB ?? 0),
}))
const topGrowth = deltas.sort((a, b) => b.delta - a.delta).slice(0, 5)
console.log('| Window | Δ MB | Messages Δ | DOM Δ |')
console.log('|---|---|---|---|')
for (const g of topGrowth) {
  const mDelta = g.to.d.chat.messagesTotal - g.from.d.chat.messagesTotal
  const dDelta = g.to.d.dom.nodes - g.from.d.dom.nodes
  console.log(`| ${g.from.ts} → ${g.to.ts} | +${g.delta.toFixed(1)} | ${mDelta >= 0 ? '+' : ''}${mDelta} | ${dDelta >= 0 ? '+' : ''}${dDelta} |`)
}

db.close()
