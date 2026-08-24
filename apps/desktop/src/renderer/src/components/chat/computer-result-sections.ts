/**
 * Split a computer_* tool result into the three things a person actually wants
 * to look at: a short field summary, the UI tree, and everything else.
 *
 * The payload is shaped for the model, not for reading — one JSON envelope with
 * a multi-thousand-character TOON table wedged inside a string field. Prettifying
 * that JSON does not help: the `\n` inside the table are string escapes, so the
 * table stays one line no matter how the envelope is indented. So lift the tables
 * out, reduce the envelope's load-bearing keys to labelled fields, and keep the
 * untouched JSON available underneath for when the summary is not enough.
 */

/** Result fields that carry a TOON table rather than a scalar. */
const TABLE_FIELDS = ['outline', 'subtree', 'element'] as const

export interface ComputerResultTable {
  key: string
  toon: string
  /** Row count declared by the TOON header, when it has one. */
  rows?: number
}

export interface ComputerResultField {
  /** i18n key under `chat.toolBlock.computer.field`. */
  labelKey: string
  value: string
}

export interface ComputerResultSections {
  fields: ComputerResultField[]
  tables: ComputerResultTable[]
  /** The envelope minus the tables, as compact JSON. */
  envelope: string
}

/** `outline[180]{ref,depth,…}:` → 180. */
export function toonRowCount(toon: string): number | undefined {
  const match = /^\s*\w+\[(\d+)\]\{/.exec(toon)
  if (!match) return undefined
  const count = Number(match[1])
  return Number.isFinite(count) ? count : undefined
}

const WAIT_STATUSES = new Set(['preexisting', 'verified', 'failed'])

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function collectFields(
  obj: Record<string, unknown>,
  tables: ComputerResultTable[],
): ComputerResultField[] {
  const fields: ComputerResultField[] = []
  const push = (labelKey: string, value: string): void => {
    if (value) fields.push({ labelKey, value })
  }

  // computer_act reports the state it landed in, under successor* names.
  const root = asRecord(obj.root) ?? asRecord(obj.successorRoot)
  const app = text(root?.app)
  const title = text(root?.title)
  push('app', app)
  // A window whose title is just the app name says nothing the app field didn't.
  if (title !== app) push('window', title)

  const outline = tables.find((table) => table.key === 'outline') ?? tables[0]
  if (outline?.rows != null) push('nodes', String(outline.rows))

  const omitted = asRecord(obj.truncation)?.nodesOmitted
  // Zero omitted is the normal case and not worth a chip.
  if (typeof omitted === 'number' && omitted > 0) push('omitted', String(omitted))

  if (Array.isArray(obj.matches)) push('matches', String(obj.matches.length))
  push('outcome', text(obj.outcome))
  // `status` is only a wait_for verdict when it is one of the three verdicts —
  // other tools use the same key for unrelated values.
  if (WAIT_STATUSES.has(text(obj.status))) push('waitStatus', text(obj.status))
  push('mode', text(obj.mode))
  push('state', text(obj.stateId) || text(obj.successorStateId))
  return fields
}

export function splitComputerResult(result: string): ComputerResultSections | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(result)
  } catch {
    return null
  }
  const obj = asRecord(parsed)
  if (!obj) return null

  const rest = { ...obj }
  const tables: ComputerResultTable[] = []
  for (const key of TABLE_FIELDS) {
    const value = rest[key]
    // Only multi-line strings are tables; a scalar of the same name stays in the
    // envelope rather than rendering as an empty code block.
    if (typeof value === 'string' && value.includes('\n')) {
      tables.push({ key, toon: value, rows: toonRowCount(value) })
      delete rest[key]
    }
  }
  return { fields: collectFields(obj, tables), tables, envelope: JSON.stringify(rest) }
}
