/**
 * Upstream API inventory for a harness, checked against its ledger at
 * docs/harness/<harness>/api-surface.md.
 *
 * The extractor only knows interface *names* per category; status, usage and
 * code locations in the ledger stay hand-written. Each ledger category is a
 * `## <Category>` section whose table rows start with a backticked name.
 *
 *   bun scripts/harness-api-inventory.ts claude          # report drift, exit 1 if any
 *   bun scripts/harness-api-inventory.ts claude --list   # print the inventory
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type Inventory = Map<string, string[]>

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function readPackageFile(pkg: string, file: string): string {
  return readFileSync(join(repoRoot, 'node_modules', pkg, file), 'utf8')
}

/** Body of `[export] declare type|interface <name> ... {` up to its closing `}` at column 0. */
function declarationOf(dts: string, name: string): string | null {
  const head = new RegExp(`^(?:export )?declare (?:type|interface) ${name}\\b[^\\n]*$`, 'm').exec(dts)
  if (!head) return null
  const start = head.index
  const firstLine = head[0]
  if (!firstLine.trimEnd().endsWith('{')) return firstLine
  const end = dts.indexOf('\n}', start)
  return dts.slice(start, end + 2)
}

function stringLiterals(text: string): string[] {
  return [...text.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** Top-level (4-space) `key: 'a' | 'b';` literals of an object type. */
function discriminator(body: string, key: string): string[] {
  const line = new RegExp(`^ {4}${key}: ([^\\n]+);$`, 'm').exec(body)
  return line ? stringLiterals(line[1]) : []
}

function unionMembers(dts: string, name: string): string[] {
  const decl = declarationOf(dts, name)
  const rhs = decl?.split('=')[1]
  if (!rhs || rhs.includes('{')) return []
  return rhs.split('|').map((s) => s.replace(/;/g, '').trim()).filter(Boolean)
}

/** Resolve a message type (or union of them) to `type` / `type/subtype` identifiers. */
function messageIds(dts: string, name: string): string[] {
  const decl = declarationOf(dts, name)
  if (!decl) return []
  if (!decl.includes('{')) return unionMembers(dts, name).flatMap((m) => messageIds(dts, m))
  const types = discriminator(decl, 'type')
  const subtypes = discriminator(decl, 'subtype')
  return types.flatMap((t) => (subtypes.length ? subtypes.map((s) => `${t}/${s}`) : [t]))
}

function objectKeys(body: string): string[] {
  return [...body.matchAll(/^ {4}(?:readonly )?([A-Za-z_]\w*)(?:<[^>]*>)?[?]?[(:]/gm)].map((m) => m[1])
}

function claudeInventory(): Inventory {
  const pkg = '@anthropic-ai/claude-agent-sdk'
  const dts = readPackageFile(pkg, 'sdk.d.ts')
  const manifest = JSON.parse(readPackageFile(pkg, 'package.json')) as { exports: Record<string, unknown> }
  const exportsList = [...dts.matchAll(/^export declare (?:function|class|const) ([A-Za-z_]\w*)/gm)].map((m) => m[1])
  const hookLine = /^export declare const HOOK_EVENTS: readonly \[([^\]]+)\]/m.exec(dts)
  return new Map([
    ['Entry points', Object.keys(manifest.exports)],
    ['Exports', exportsList],
    ['Options', objectKeys(declarationOf(dts, 'Options') ?? '')],
    ['Query methods', objectKeys(declarationOf(dts, 'Query') ?? '')],
    ['Messages', unionMembers(dts, 'SDKMessage').flatMap((m) => messageIds(dts, m))],
    ['Hook events', hookLine ? stringLiterals(hookLine[1]) : []],
    ['Control requests', unionMembers(dts, 'SDKControlRequestInner').flatMap((m) => discriminator(declarationOf(dts, m) ?? '', 'subtype'))],
  ].map(([k, v]) => [k as string, [...new Set(v as string[])].sort()]))
}

const extractors: Record<string, () => Inventory> = { claude: claudeInventory }

function ledgerOf(harness: string): Inventory {
  const text = readFileSync(join(repoRoot, 'docs/harness', harness, 'api-surface.md'), 'utf8')
  const ledger: Inventory = new Map()
  let current: string[] | null = null
  for (const line of text.split('\n')) {
    const heading = /^## (.+)$/.exec(line)
    if (heading) {
      current = []
      ledger.set(heading[1].trim(), current)
      continue
    }
    const row = /^\| `([^`]+)`/.exec(line)
    if (row && current) current.push(row[1])
  }
  return ledger
}

const [harness, flag] = process.argv.slice(2)
const extract = harness ? extractors[harness] : undefined
if (!extract) {
  console.error(`usage: bun scripts/harness-api-inventory.ts <${Object.keys(extractors).join('|')}> [--list]`)
  process.exit(2)
}

const inventory = extract()
if (flag === '--list') {
  for (const [category, names] of inventory) {
    console.log(`## ${category} (${names.length})\n${names.map((n) => `  ${n}`).join('\n')}\n`)
  }
  process.exit(0)
}

const ledger = ledgerOf(harness)
let drift = 0
for (const [category, names] of inventory) {
  const rows = new Set(ledger.get(category) ?? [])
  const missing = names.filter((n) => !rows.has(n))
  const stale = [...rows].filter((n) => !names.includes(n))
  if (!ledger.has(category)) console.log(`${category}: section missing`)
  if (missing.length) console.log(`${category}: missing ${missing.join(', ')}`)
  if (stale.length) console.log(`${category}: not upstream ${stale.join(', ')}`)
  drift += missing.length + stale.length + (ledger.has(category) ? 0 : 1)
}
console.log(drift ? `${drift} drift item(s)` : `api-surface.md matches ${harness} upstream`)
process.exit(drift ? 1 : 0)
