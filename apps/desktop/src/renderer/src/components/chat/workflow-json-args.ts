import type { WorkflowArgSpec } from '@superone/shared/workflow-args'

/**
 * Helpers for `/workflow <name> {…json…}` editing in the slash popup.
 * The host does not run a full JSON parser mid-type — we use tolerant
 * extraction so key chips stay useful while the user is still typing.
 */

/** Everything after the workflow display name (may include leading space). */
export function extractJsonArgsTail(argsText: string, workflowName: string): string {
  const trimmed = argsText.replace(/^\s+/, '')
  if (!trimmed.startsWith(workflowName)) return argsText.trim()
  return trimmed.slice(workflowName.length).replace(/^\s+/, '')
}

/** Keys already present in a partial JSON object (best-effort). */
export function extractPresentJsonKeys(jsonTail: string): Set<string> {
  const keys = new Set<string>()
  const re = /"([^"\\]+)"\s*:/g
  let m: RegExpExecArray | null
  while ((m = re.exec(jsonTail))) {
    keys.add(m[1]!)
  }
  return keys
}

export function guessDefaultValue(spec: WorkflowArgSpec): unknown {
  const d = (spec.description ?? '').toLowerCase()
  const n = spec.name.toLowerCase()
  if (d.includes('array') || (n.endsWith('s') && (d.includes('list') || d.includes('ids') || d.includes('domain')))) {
    return []
  }
  if (
    d.includes('number')
    || d.includes('int')
    || d.includes('max')
    || n.includes('count')
    || n.includes('budget')
    || n.includes('breadth')
    || n.includes('verify')
  ) {
    const m = d.match(/default:\s*(\d+)/i) || d.match(/\b(\d+)\b/)
    return m ? Number(m[1]) : 0
  }
  if (d.includes('bool') || n.startsWith('is_') || n.startsWith('enable')) return false
  return ''
}

/**
 * Merge `key` into the JSON object after `/workflow name`, preserving other keys.
 * If no JSON yet, start a new object with that key.
 */
export function mergeArgIntoWorkflowLine(
  workflowName: string,
  currentArgsText: string,
  spec: WorkflowArgSpec,
  allSpecs: WorkflowArgSpec[],
): string {
  const tail = extractJsonArgsTail(currentArgsText, workflowName)
  let obj: Record<string, unknown> = {}
  const trimmed = tail.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        obj = { ...(parsed as Record<string, unknown>) }
      }
    } catch {
      // Incomplete JSON — fall back to key set + rebuild
      for (const key of extractPresentJsonKeys(trimmed)) {
        if (!(key in obj)) obj[key] = guessDefaultForName(key, allSpecs)
      }
    }
  }
  if (!(spec.name in obj)) {
    obj[spec.name] = guessDefaultValue(spec)
  }
  return `/workflow ${workflowName} ${JSON.stringify(obj)} `
}

function guessDefaultForName(name: string, specs: WorkflowArgSpec[]): unknown {
  const spec = specs.find((s) => s.name === name)
  return spec ? guessDefaultValue(spec) : ''
}

/** Build a full example object from specs (same idea as script exampleJson). */
export function buildArgsExampleObject(specs: WorkflowArgSpec[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (const s of specs.slice(0, 6)) {
    obj[s.name] = guessDefaultValue(s)
  }
  return obj
}

export function buildWorkflowJsonLine(workflowName: string, obj: Record<string, unknown>): string {
  return `/workflow ${workflowName} ${JSON.stringify(obj)} `
}

/**
 * While typing after the name: suggest missing arg keys that match the
 * incomplete token after the last `{` / `,` (e.g. user typed `{"fo`).
 */
export function suggestJsonKeys(
  jsonTail: string,
  specs: WorkflowArgSpec[],
): Array<WorkflowArgSpec & { alreadyPresent: boolean }> {
  const present = extractPresentJsonKeys(jsonTail)
  const partialKey = currentPartialKey(jsonTail)
  const q = partialKey.toLowerCase()
  return specs
    .map((s) => ({
      ...s,
      alreadyPresent: present.has(s.name),
    }))
    .filter((s) => {
      if (s.alreadyPresent && !q) return false
      if (!q) return !s.alreadyPresent
      return s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q)
    })
}

/** Incomplete key token at the end of a partial JSON object, or "". */
export function currentPartialKey(jsonTail: string): string {
  const t = jsonTail.trimEnd()
  // Match trailing `"partial` or `{partial` or `, partial` without closing quote/colon
  const m = t.match(/(?:\{|,)\s*"?([a-zA-Z_][\w]*)$/)
  if (m) return m[1]!
  // Bare typing after name without `{` yet — treat as key filter
  if (t && !t.startsWith('{') && !t.startsWith('[')) {
    return t.replace(/^["']/, '')
  }
  return ''
}

/** Whether the user is in JSON-args editing mode for a named workflow. */
export function isEditingJsonArgs(argsText: string, workflowName: string): boolean {
  const tail = extractJsonArgsTail(argsText, workflowName)
  if (!tail) return true // empty → show arg builder
  if (tail.startsWith('{') || tail.startsWith('[')) return true
  // Freeform filter text still counts as args mode (key search)
  return !/^(pause|resume|stop|save)(\s|$)/i.test(tail)
}
