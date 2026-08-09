import type { WorkflowArgSpec } from '@superone/shared/workflow-args'
import { fuzzyMatch } from '@/lib/fuzzy-match'

export type ArgKind = 'string' | 'number' | 'boolean' | 'string[]'

/** Everything after `/workflow <name>` (may be empty). */
export function extractArgsTail(argsText: string, workflowName: string): string {
  const trimmed = argsText.replace(/^\s+/, '')
  if (!trimmed.startsWith(workflowName)) return argsText.trimStart()
  return trimmed.slice(workflowName.length).replace(/^\s+/, '')
}

export function inferArgKind(spec: WorkflowArgSpec): ArgKind {
  const d = (spec.description ?? '').toLowerCase()
  const n = spec.name.toLowerCase()
  if (
    d.includes('array')
    || d.includes('list of')
    || (n.endsWith('s') && (d.includes('ids') || d.includes('domain') || n === 'domains'))
  ) {
    return 'string[]'
  }
  if (
    d.includes('number')
    || d.includes('int')
    || d.includes('max')
    || n.includes('count')
    || n.includes('budget')
    || n.includes('breadth')
    || n.includes('verify')
    || n.includes('size')
    || n.includes('packages')
    || n.includes('waves')
  ) {
    return 'number'
  }
  if (
    d.includes('bool')
    || n.startsWith('is_')
    || n.startsWith('enable')
    || n.startsWith('skip_')
    || n.startsWith('auto_')
    || n.includes('approve')
  ) {
    return 'boolean'
  }
  return 'string'
}

export function guessDefaultValue(spec: WorkflowArgSpec): unknown {
  const kind = inferArgKind(spec)
  const d = (spec.description ?? '').toLowerCase()
  if (kind === 'string[]') return []
  if (kind === 'boolean') return false
  if (kind === 'number') {
    const m = d.match(/default:\s*(\d+)/i) || d.match(/\b(\d+)\b/)
    return m ? Number(m[1]) : 0
  }
  // string: pull default: "…" or default: bare from description when short
  const quoted = (spec.description ?? '').match(/default:\s*["']([^"']+)["']/i)
  if (quoted) return quoted[1]
  const bare = (spec.description ?? '').match(/default:\s*([^,;)]+)/i)
  if (bare) {
    const v = bare[1]!.trim()
    if (v && !/^all\b/i.test(v) && v.length < 48) return v
  }
  return ''
}

/** Format a value for CLI insertion after `key=`. */
export function formatCliValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    // comma list is friendlier for Tab-out than JSON array
    return value.map(String).join(',')
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  const s = String(value ?? '')
  if (s === '') return '""'
  if (/[\s="'`]/.test(s) || s.includes(',')) return JSON.stringify(s)
  return s
}

export function formatCliDefault(spec: WorkflowArgSpec): string {
  return formatCliValue(guessDefaultValue(spec))
}

export interface CliPair {
  key: string
  value: string
  /** Absolute offsets within the args tail (not full command line). */
  keyStart: number
  valueStart: number
  valueEnd: number
  complete: boolean
}

export type CliTrailing =
  | { kind: 'empty' }
  | { kind: 'partialKey'; text: string; start: number }
  | { kind: 'expectKey' }
  | { kind: 'inValue'; key: string; value: string; valueStart: number; valueEnd: number }

export interface CliParseResult {
  pairs: CliPair[]
  trailing: CliTrailing
  /** Free-text blob when no key= was used (Grok-native query mode). */
  freeText: string | null
}

/**
 * Tokenize CLI args: `key=value key2=val2 partial`
 * Values may be `""`, `[]`, bare words, or "quoted strings".
 */
export function parseCliArgsTail(tail: string): CliParseResult {
  const t = tail
  if (!t.trim()) {
    return { pairs: [], trailing: { kind: 'empty' }, freeText: null }
  }

  // Pure free text (no `=`) → Grok query/objective mode
  if (!t.includes('=')) {
    const trimmed = t.trimEnd()
    const trailingSpace = t.length > 0 && /\s$/.test(t)
    if (trailingSpace) {
      return {
        pairs: [],
        trailing: { kind: 'expectKey' },
        freeText: trimmed || null,
      }
    }
    return {
      pairs: [],
      trailing: { kind: 'partialKey', text: trimmed, start: t.search(/\S/) },
      freeText: trimmed || null,
    }
  }

  const pairs: CliPair[] = []
  let i = 0
  const n = t.length

  const skipWs = () => {
    while (i < n && /\s/.test(t[i]!)) i++
  }

  while (i < n) {
    skipWs()
    if (i >= n) break
    const tokenStart = i

    // Read key
    while (i < n && /[a-zA-Z0-9_]/.test(t[i]!)) i++
    const key = t.slice(tokenStart, i)
    if (!key) {
      // garbage — treat rest as free partial
      return {
        pairs,
        trailing: { kind: 'partialKey', text: t.slice(tokenStart).trim(), start: tokenStart },
        freeText: null,
      }
    }

    if (t[i] !== '=') {
      // incomplete key at end
      const rest = t.slice(i)
      if (!rest.trim()) {
        return {
          pairs,
          trailing: { kind: 'partialKey', text: key, start: tokenStart },
          freeText: null,
        }
      }
      // key without = mid-stream — stop
      return {
        pairs,
        trailing: { kind: 'partialKey', text: key + rest.trimEnd(), start: tokenStart },
        freeText: null,
      }
    }
    i++ // skip =
    const valueStart = i
    let value = ''

    if (i >= n) {
      // key= at end
      return {
        pairs,
        trailing: {
          kind: 'inValue',
          key,
          value: '',
          valueStart,
          valueEnd: valueStart,
        },
        freeText: null,
      }
    }

    if (t[i] === '"') {
      // quoted string
      i++
      let out = '"'
      while (i < n) {
        const c = t[i]!
        out += c
        i++
        if (c === '\\' && i < n) {
          out += t[i]
          i++
          continue
        }
        if (c === '"') break
      }
      value = out
    } else if (t[i] === '[') {
      // [] or [a,b]
      let depth = 0
      const start = i
      while (i < n) {
        if (t[i] === '[') depth++
        if (t[i] === ']') {
          depth--
          i++
          if (depth === 0) break
          continue
        }
        i++
      }
      value = t.slice(start, i)
    } else {
      // bare token until whitespace
      while (i < n && !/\s/.test(t[i]!)) i++
      value = t.slice(valueStart, i)
    }

    const valueEnd = i
    const complete = value.length > 0 || t[valueStart - 1] === '=' // key= with empty → incomplete prefer inValue
    // key= with empty value and end: already handled
    // key= followed by space: empty string value complete
    const nextIsSpaceOrEnd = i >= n || /\s/.test(t[i]!)
    if (value === '' && i < n && /\s/.test(t[i]!)) {
      // key=  (space after) → empty value complete
      pairs.push({
        key,
        value: '',
        keyStart: tokenStart,
        valueStart,
        valueEnd,
        complete: true,
      })
      continue
    }

    if (value === '' && i >= n) {
      return {
        pairs,
        trailing: { kind: 'inValue', key, value: '', valueStart, valueEnd },
        freeText: null,
      }
    }

    pairs.push({
      key,
      value,
      keyStart: tokenStart,
      valueStart,
      valueEnd,
      complete: true,
    })

    // If no trailing whitespace and end of string, cursor is "in" this value for Tab purposes
    if (i >= n) {
      return {
        pairs,
        trailing: {
          kind: 'inValue',
          key,
          value,
          valueStart,
          valueEnd,
        },
        freeText: null,
      }
    }
  }

  // Ended after complete pairs with trailing space
  if (/\s$/.test(t)) {
    return { pairs, trailing: { kind: 'expectKey' }, freeText: null }
  }
  return { pairs, trailing: { kind: 'empty' }, freeText: null }
}

export function presentCliKeys(tail: string): Set<string> {
  const { pairs } = parseCliArgsTail(tail)
  return new Set(pairs.filter((p) => p.complete).map((p) => p.key))
}

export function suggestCliKeys(
  tail: string,
  specs: WorkflowArgSpec[],
): Array<WorkflowArgSpec & { score: number; matchIndices: number[] }> {
  const parsed = parseCliArgsTail(tail)
  const present = new Set(parsed.pairs.filter((p) => p.complete).map((p) => p.key))
  let q = ''
  if (parsed.trailing.kind === 'partialKey') q = parsed.trailing.text.toLowerCase()
  else if (parsed.trailing.kind === 'empty' || parsed.trailing.kind === 'expectKey') q = ''
  else return [] // inValue — don't list keys

  const out: Array<WorkflowArgSpec & { score: number; matchIndices: number[] }> = []
  for (const s of specs) {
    if (present.has(s.name) && !q) continue
    if (present.has(s.name) && q && !s.name.toLowerCase().startsWith(q)) continue
    if (!q) {
      if (!present.has(s.name)) {
        out.push({ ...s, score: 0, matchIndices: [] })
      }
      continue
    }
    const r = fuzzyMatch(q, s.name)
    if (r.match) out.push({ ...s, score: r.score, matchIndices: r.indices })
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}

export interface CliApplyResult {
  /** Full first-line command text */
  line: string
  /** Character offsets in `line` to select (value region), exclusive end */
  selectFrom?: number
  selectTo?: number
}

/**
 * Tab on a key suggestion: append/replace trailing partial with `key=default`
 * and select the default value for editing.
 */
export function applyKeyWithDefault(
  workflowName: string,
  argsText: string,
  spec: WorkflowArgSpec,
): CliApplyResult {
  const tail = extractArgsTail(argsText, workflowName)
  const parsed = parseCliArgsTail(tail)
  const def = formatCliDefault(spec)

  // Rebuild completed pairs only
  const kept = parsed.pairs
    .filter((p) => p.complete && p.key !== spec.name)
    .map((p) => `${p.key}=${p.value}`)

  kept.push(`${spec.name}=${def}`)
  const newTail = kept.join(' ')
  const line = `/workflow ${workflowName} ${newTail}`
  // Select the default value characters
  const valueInTailStart = newTail.length - def.length
  const prefix = `/workflow ${workflowName} `
  return {
    line,
    selectFrom: prefix.length + valueInTailStart,
    selectTo: prefix.length + newTail.length,
  }
}

/**
 * Tab while in a value (or after completing one): commit current pairs and move
 * the caret to a trailing space so the user can type/match the *next key*
 * themselves — do **not** auto-fill the next key=default.
 */
export function tabOutOfValue(
  workflowName: string,
  argsText: string,
): CliApplyResult {
  const tail = extractArgsTail(argsText, workflowName)
  const parsed = parseCliArgsTail(tail)
  const kept = parsed.pairs.filter((p) => p.complete).map((p) => `${p.key}=${p.value}`)

  // If we're mid-value on an incomplete trailing pair, include it as committed.
  if (parsed.trailing.kind === 'inValue') {
    const { key, value } = parsed.trailing
    if (!kept.some((p) => p.startsWith(`${key}=`))) {
      kept.push(`${key}=${value}`)
    } else {
      // Replace last occurrence of this key with current value
      for (let i = kept.length - 1; i >= 0; i--) {
        if (kept[i]!.startsWith(`${key}=`)) {
          kept[i] = `${key}=${value}`
          break
        }
      }
    }
  }

  const newTail = kept.join(' ')
  const line = newTail
    ? `/workflow ${workflowName} ${newTail} `
    : `/workflow ${workflowName} `
  // Caret at end (after space) — ready to match next key; no text selected.
  return { line }
}

/**
 * @deprecated Use tabOutOfValue — Tab after a param no longer auto-matches the next key.
 */
export function tabToNextKey(
  workflowName: string,
  argsText: string,
  _specs: WorkflowArgSpec[],
): CliApplyResult {
  return tabOutOfValue(workflowName, argsText)
}

function parseCliValue(raw: string, kind: ArgKind): unknown {
  if (kind === 'string[]') {
    if (raw === '[]' || raw === '') return []
    if (raw.startsWith('[')) {
      try {
        const v = JSON.parse(raw) as unknown
        if (Array.isArray(v)) return v.map(String)
      } catch { /* fall through */ }
    }
    return raw.split(',').map((s) => s.trim()).filter(Boolean)
  }
  if (kind === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }
  if (kind === 'boolean') {
    if (raw === '' || raw === 'true') return true
    if (raw === 'false') return false
    return Boolean(raw)
  }
  // string
  if (
    (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2)
    || (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
  ) {
    try {
      return JSON.parse(raw.replace(/^'/, '"').replace(/'$/, '"')) as string
    } catch {
      return raw.slice(1, -1)
    }
  }
  return raw
}

/**
 * Convert CLI args tail to a JSON object for the agent.
 * - Pure free text (no `=`) → null (leave for Grok native query/objective)
 * - key=value pairs → object
 */
export function cliArgsTailToJson(
  tail: string,
  specs: WorkflowArgSpec[],
): { mode: 'json'; value: Record<string, unknown> } | { mode: 'freeText'; text: string } | { mode: 'empty' } {
  const t = tail.trim()
  if (!t) return { mode: 'empty' }
  if (t.startsWith('{')) {
    try {
      const v = JSON.parse(t) as unknown
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return { mode: 'json', value: v as Record<string, unknown> }
      }
    } catch { /* treat as free / cli */ }
  }
  if (!t.includes('=')) {
    return { mode: 'freeText', text: t }
  }
  const { pairs } = parseCliArgsTail(t.endsWith(' ') ? t : `${t} `)
  const kindByName = new Map(specs.map((s) => [s.name, inferArgKind(s)]))
  const obj: Record<string, unknown> = {}
  for (const p of pairs) {
    if (!p.complete) continue
    const kind = kindByName.get(p.key) ?? 'string'
    obj[p.key] = parseCliValue(p.value, kind)
  }
  return { mode: 'json', value: obj }
}

/** Ghost hint of remaining keys for CLI style. */
export function remainingCliGhost(tail: string, specs: WorkflowArgSpec[]): string | null {
  const present = presentCliKeys(tail.endsWith(' ') || !tail ? `${tail}` : tail)
  // if mid-value, no ghost
  const parsed = parseCliArgsTail(tail)
  if (parsed.trailing.kind === 'inValue') return null
  if (parsed.trailing.kind === 'partialKey' && parsed.trailing.text) return null
  const rest = specs.filter((s) => !present.has(s.name))
  if (rest.length === 0) return null
  return rest.map((s) => `${s.name}=…`).join(' ')
}

/**
 * Rewrite `/workflow name …` agent content: CLI key=value → JSON object string.
 */
export function rewriteWorkflowCommandForAgent(
  content: string,
  specsForName: (name: string) => WorkflowArgSpec[],
): string {
  const m = content.match(/^(\/workflow\s+)(\S+)(?:\s+([\s\S]*))?$/i)
  if (!m) return content
  const prefix = m[1]!
  const name = m[2]!
  const rest = (m[3] ?? '').trim()
  if (!rest) return content
  if (rest.startsWith('{')) return content
  const converted = cliArgsTailToJson(rest, specsForName(name))
  if (converted.mode === 'empty') return `${prefix}${name}`
  if (converted.mode === 'freeText') return content // Grok native
  return `${prefix}${name} ${JSON.stringify(converted.value)}`
}
