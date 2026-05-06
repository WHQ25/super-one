const FILE = process.argv[2]
if (!FILE) {
  console.error('Usage: bun scripts/analyze-heap.ts <heap.heapsnapshot>')
  process.exit(1)
}

const NODE_TYPES = [
  'hidden', 'array', 'string', 'object', 'code', 'closure', 'regexp',
  'number', 'native', 'synthetic', 'concatenated string', 'sliced string',
  'symbol', 'bigint', 'object shape',
] as const

const NODE_FIELD_COUNT = 6

const enum S { Header, Nodes, AfterNodes, Strings, Done }

let state: S = S.Header
let headerBuf = ''

let fieldNum = 0
let fieldIdx = 0
let inNumber = false
const curNode = new Int32Array(NODE_FIELD_COUNT)

const nameAgg = new Map<number, { count: number; size: number; typeCount: Map<number, number> }>()
const typeTotal: { count: number; size: number }[] = Array.from({ length: NODE_TYPES.length }, () => ({ count: 0, size: 0 }))
let totalNodes = 0
let totalSelfSize = 0

function processNode(): void {
  const type = curNode[0]
  const nameId = curNode[1]
  const selfSize = curNode[3]
  typeTotal[type].count++
  typeTotal[type].size += selfSize
  totalNodes++
  totalSelfSize += selfSize
  let agg = nameAgg.get(nameId)
  if (!agg) {
    agg = { count: 0, size: 0, typeCount: new Map() }
    nameAgg.set(nameId, agg)
  }
  agg.count++
  agg.size += selfSize
  agg.typeCount.set(type, (agg.typeCount.get(type) ?? 0) + 1)
}

let stringIdx = 0
const stringBytes: number[] = []
let inString = false
let escapeNext = false
const strings = new Map<number, string>()
let neededIds: Set<number> | null = null

const LARGEST_STRINGS: { id: number; len: number; preview: string }[] = []
const TOP_LARGEST = 20

function flushString(): void {
  const len = stringBytes.length
  if (neededIds?.has(stringIdx)) {
    strings.set(stringIdx, Buffer.from(stringBytes).toString('utf8'))
  }
  if (LARGEST_STRINGS.length < TOP_LARGEST || len > LARGEST_STRINGS[LARGEST_STRINGS.length - 1].len) {
    const preview = Buffer.from(stringBytes.slice(0, 200)).toString('utf8')
    LARGEST_STRINGS.push({ id: stringIdx, len, preview })
    LARGEST_STRINGS.sort((a, b) => b.len - a.len)
    if (LARGEST_STRINGS.length > TOP_LARGEST) LARGEST_STRINGS.length = TOP_LARGEST
  }
  stringBytes.length = 0
  stringIdx++
}

const start = performance.now()
let bytesRead = 0
const totalBytes = (await Bun.file(FILE).stat()).size
let lastProgress = 0

const stream = Bun.file(FILE).stream()

outer:
for await (const chunk of stream) {
  bytesRead += chunk.length
  if (bytesRead - lastProgress > 200 * 1024 * 1024) {
    lastProgress = bytesRead
    const pct = ((bytesRead / totalBytes) * 100).toFixed(1)
    process.stderr.write(`  ${pct}% (${(bytesRead / 1024 / 1024 / 1024).toFixed(2)} GB, ${((performance.now() - start) / 1000).toFixed(1)}s, nodes=${totalNodes}) state=${S[state]}\n`)
  }

  for (let i = 0; i < chunk.length; i++) {
    const b = chunk[i]
    switch (state) {
      case S.Header:
        headerBuf += String.fromCharCode(b)
        if (headerBuf.length > 32) headerBuf = headerBuf.slice(-16)
        if (b === 0x5B && headerBuf.endsWith('"nodes":[')) {
          state = S.Nodes
          headerBuf = ''
        }
        break

      case S.Nodes:
        if (b >= 0x30 && b <= 0x39) {
          fieldNum = fieldNum * 10 + (b - 0x30)
          inNumber = true
        } else if (b === 0x2C) {
          if (inNumber) {
            curNode[fieldIdx++] = fieldNum
            fieldNum = 0
            inNumber = false
            if (fieldIdx === NODE_FIELD_COUNT) {
              processNode()
              fieldIdx = 0
            }
          }
        } else if (b === 0x5D) {
          if (inNumber) {
            curNode[fieldIdx++] = fieldNum
            fieldNum = 0
            inNumber = false
            if (fieldIdx === NODE_FIELD_COUNT) {
              processNode()
              fieldIdx = 0
            }
          }
          state = S.AfterNodes
          neededIds = new Set(nameAgg.keys())
        }
        break

      case S.AfterNodes:
        headerBuf += String.fromCharCode(b)
        if (headerBuf.length > 32) headerBuf = headerBuf.slice(-16)
        if (b === 0x5B && headerBuf.endsWith('"strings":[')) {
          state = S.Strings
          headerBuf = ''
        }
        break

      case S.Strings:
        if (inString) {
          if (escapeNext) {
            stringBytes.push(b)
            escapeNext = false
          } else if (b === 0x5C) {
            escapeNext = true
          } else if (b === 0x22) {
            flushString()
            inString = false
          } else {
            stringBytes.push(b)
          }
        } else {
          if (b === 0x22) { inString = true }
          else if (b === 0x5D) {
            state = S.Done
            break outer
          }
        }
        break

      case S.Done:
        break outer
    }
  }
}

const elapsed = ((performance.now() - start) / 1000).toFixed(1)
process.stderr.write(`Parsed in ${elapsed}s. nodes=${totalNodes}, unique name ids=${nameAgg.size}\n\n`)

console.log(`# Heap Snapshot Analysis\n`)
console.log(`File: \`${FILE}\``)
console.log(`Total nodes: ${totalNodes.toLocaleString()}`)
console.log(`Total self_size: ${(totalSelfSize / 1024 / 1024).toFixed(1)} MB\n`)

console.log(`## Nodes by Type\n`)
console.log(`| Type | Count | Self Size | % |`)
console.log(`|---|---:|---:|---:|`)
for (let t = 0; t < NODE_TYPES.length; t++) {
  const tt = typeTotal[t]
  if (tt.count === 0) continue
  const pct = ((tt.size / totalSelfSize) * 100).toFixed(1)
  console.log(`| ${NODE_TYPES[t]} | ${tt.count.toLocaleString()} | ${(tt.size / 1024 / 1024).toFixed(1)} MB | ${pct}% |`)
}

console.log(`\n## Top 50 Constructors by Count\n`)
const byCount = [...nameAgg.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 50)
console.log(`| Constructor (name) | Count | Self Size | Primary Type |`)
console.log(`|---|---:|---:|---|`)
for (const [nameId, agg] of byCount) {
  const name = strings.get(nameId) ?? `<id:${nameId}>`
  const display = name.length > 80 ? name.slice(0, 80) + '...' : name
  const primaryType = [...agg.typeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
  console.log(`| \`${display.replace(/\|/g, '\\|')}\` | ${agg.count.toLocaleString()} | ${(agg.size / 1024 / 1024).toFixed(1)} MB | ${NODE_TYPES[primaryType]} |`)
}

console.log(`\n## Top 30 Constructors by Self Size\n`)
const bySize = [...nameAgg.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 30)
console.log(`| Constructor (name) | Self Size | Count | Avg |`)
console.log(`|---|---:|---:|---:|`)
for (const [nameId, agg] of bySize) {
  const name = strings.get(nameId) ?? `<id:${nameId}>`
  const display = name.length > 80 ? name.slice(0, 80) + '...' : name
  const avg = agg.count === 0 ? 0 : agg.size / agg.count
  console.log(`| \`${display.replace(/\|/g, '\\|')}\` | ${(agg.size / 1024 / 1024).toFixed(1)} MB | ${agg.count.toLocaleString()} | ${avg.toFixed(0)} B |`)
}

console.log(`\n## Top ${TOP_LARGEST} Largest Strings (by byte length)\n`)
console.log(`| id | Length | Preview |`)
console.log(`|---:|---:|---|`)
for (const s of LARGEST_STRINGS) {
  const safe = s.preview.replace(/\|/g, '\\|').replace(/\n/g, '⏎').replace(/`/g, "'")
  console.log(`| ${s.id} | ${(s.len / 1024).toFixed(1)} KB | ${safe.slice(0, 160)} |`)
}
