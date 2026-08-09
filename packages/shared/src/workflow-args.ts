/**
 * Best-effort extraction of workflow `args` fields from a Rhai script.
 *
 * Sources (priority):
 * 1. Documented comment lines under an args section, e.g.
 *      //   focus      — free-text emphasis (default: …)
 * 2. Property access `args.field` / `a.field` after `let a = … args`
 *
 * Meta `when_to_use` is also parsed when present as a string literal.
 */

export interface WorkflowArgSpec {
  name: string
  description?: string
  /** Heuristic: mentioned as required / non-optional in docs or pause messages. */
  required?: boolean
}

export interface WorkflowScriptHints {
  whenToUse?: string
  args: WorkflowArgSpec[]
  /** Compact example JSON object string, e.g. `{"focus":"","max_verify":16}`. */
  exampleJson?: string
}

const SKIP_ARGS = new Set([
  'to_string',
  'len',
  'keys',
  'values',
  'contains',
  'get',
  'remove',
  'clear',
  'is_empty',
])

/** `//   name   — description` or `//   name - description` (em/en dash). */
const COMMENT_ARG_RE = /^\/\/\s+([a-zA-Z_][\w]*)\s*(?:—|–|-)\s*(.+?)\s*$/

/** `args.field` or `a.field` / `opts.field` after binding from args. */
const ARGS_PROP_RE = /\b(?:args|a)\.([a-zA-Z_][\w]*)\b/g

export function extractWorkflowWhenToUse(script: string): string | undefined {
  // when_to_use: "…"  (allow escaped quotes poorly — good enough for our scripts)
  const m = script.match(/when_to_use\s*:\s*"((?:\\.|[^"\\])*)"/)
  if (!m?.[1]) return undefined
  return m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim() || undefined
}

function isArgsSectionHeader(line: string): boolean {
  const t = line.replace(/^\/\/\s*/, '').trim().toLowerCase()
  if (!t) return false
  if (/^args?\b/.test(t)) return true
  if (t.includes('optional object fields')) return true
  if (t.includes('optional args')) return true
  if (t.includes('arguments')) return true
  return false
}

/**
 * Pull documented fields from comment blocks that look like an args section.
 */
export function extractArgsFromComments(script: string): WorkflowArgSpec[] {
  const lines = script.split(/\r?\n/)
  const out: WorkflowArgSpec[] = []
  const seen = new Set<string>()
  let inArgsSection = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('//')) {
      // Leaving a pure-comment args block once code resumes (but allow blank code gaps).
      if (inArgsSection && trimmed !== '' && !trimmed.startsWith('//')) {
        // Keep scanning for more `//   field —` later; section flag only helps priority.
        inArgsSection = false
      }
      continue
    }

    if (isArgsSectionHeader(trimmed)) {
      inArgsSection = true
      continue
    }

    const m = trimmed.match(COMMENT_ARG_RE)
    if (!m) continue
    // Prefer fields inside an args section; still accept clearly documented lines anywhere.
    if (!inArgsSection && !/optional|default|required|pass |array|string|number|bool/i.test(m[2]!)) {
      continue
    }
    const name = m[1]!
    if (seen.has(name) || SKIP_ARGS.has(name)) continue
    seen.add(name)
    const description = m[2]!.trim()
    const required = /\brequired\b/i.test(description) && !/\boptional\b/i.test(description)
    out.push({ name, description, required })
  }
  return out
}

/**
 * Collect `args.foo` / `a.foo` property names from the script body.
 */
export function extractArgsFromAccesses(script: string): string[] {
  const names = new Set<string>()
  for (const m of script.matchAll(ARGS_PROP_RE)) {
    const name = m[1]!
    if (SKIP_ARGS.has(name)) continue
    names.add(name)
  }
  return [...names].sort()
}

export function extractWorkflowScriptHints(script: string): WorkflowScriptHints {
  const whenToUse = extractWorkflowWhenToUse(script)
  const fromComments = extractArgsFromComments(script)
  const fromAccess = extractArgsFromAccesses(script)

  const byName = new Map<string, WorkflowArgSpec>()
  for (const a of fromComments) byName.set(a.name, a)
  for (const name of fromAccess) {
    if (!byName.has(name)) byName.set(name, { name })
  }

  // Stable: documented first (comment order), then remaining alpha.
  const args: WorkflowArgSpec[] = []
  const seen = new Set<string>()
  for (const a of fromComments) {
    args.push(byName.get(a.name)!)
    seen.add(a.name)
  }
  for (const name of fromAccess) {
    if (seen.has(name)) continue
    args.push(byName.get(name)!)
    seen.add(name)
  }

  const exampleJson = buildExampleJson(args)

  return { whenToUse, args, exampleJson }
}

function buildExampleJson(args: WorkflowArgSpec[]): string | undefined {
  if (args.length === 0) return undefined
  // Prefer a short example of the first few documented/required fields.
  const pick = [
    ...args.filter((a) => a.required),
    ...args.filter((a) => !a.required),
  ].slice(0, 4)

  const obj: Record<string, unknown> = {}
  for (const a of pick) {
    obj[a.name] = guessExampleValue(a)
  }
  try {
    return JSON.stringify(obj)
  } catch {
    return undefined
  }
}

function guessExampleValue(a: WorkflowArgSpec): unknown {
  const d = (a.description ?? '').toLowerCase()
  const n = a.name.toLowerCase()
  if (d.includes('array') || n.endsWith('s') && (d.includes('list') || d.includes('ids'))) return []
  if (d.includes('number') || d.includes('int') || d.includes('max') || n.includes('count') || n.includes('budget') || n.includes('breadth')) {
    const m = d.match(/default:\s*(\d+)/i) || d.match(/\b(\d+)\b/)
    return m ? Number(m[1]) : 0
  }
  if (d.includes('bool') || n.startsWith('is_') || n.startsWith('enable')) return false
  if (n.includes('path') || n.endsWith('_path')) return ''
  if (n === 'query' || n === 'objective' || n === 'focus') return ''
  return ''
}

/** Build `/workflow name {…}` with example args when available. */
export function buildWorkflowLaunchLine(name: string, exampleJson?: string): string {
  if (exampleJson && exampleJson !== '{}' && exampleJson !== '[]') {
    return `/workflow ${name} ${exampleJson} `
  }
  return `/workflow ${name} `
}
