import { extractJsonStringValue } from '@superone/shared/partial-json'

export interface WorkflowPhase {
  title: string
  detail?: string
}

export interface WorkflowMeta {
  name: string
  description: string
  phases: WorkflowPhase[]
}

export interface WorkflowLaunchInfo {
  transcriptDir?: string
  taskId?: string
  runId?: string
  scriptPath?: string
}

function quotedValue(src: string, key: string): string | undefined {
  const m = src.match(new RegExp(`${key}\\s*:\\s*(['"\`])([\\s\\S]*?)\\1`))
  return m ? m[2] : undefined
}

function extractPhases(metaSrc: string): WorkflowPhase[] {
  const keyIdx = metaSrc.indexOf('phases')
  if (keyIdx < 0) return []
  const start = metaSrc.indexOf('[', keyIdx)
  if (start < 0) return []
  let depth = 0
  let end = -1
  for (let i = start; i < metaSrc.length; i++) {
    const c = metaSrc[i]
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) return []
  const arr = metaSrc.slice(start + 1, end)
  const phases: WorkflowPhase[] = []
  const objRe = /\{([\s\S]*?)\}/g
  let m: RegExpExecArray | null
  while ((m = objRe.exec(arr))) {
    const title = quotedValue(m[1], 'title')
    if (title) phases.push({ title, detail: quotedValue(m[1], 'detail') })
  }
  return phases
}

export function parseWorkflowScript(script: string): WorkflowMeta {
  const metaIdx = script.indexOf('meta')
  const metaSrc = metaIdx >= 0 ? script.slice(metaIdx) : script
  return {
    name: quotedValue(metaSrc, 'name') ?? '',
    description: quotedValue(metaSrc, 'description') ?? '',
    phases: extractPhases(metaSrc),
  }
}

export function extractWorkflowScript(input: string): string | undefined {
  try {
    const o = JSON.parse(input) as Record<string, unknown>
    if (typeof o?.script === 'string') return o.script
  } catch {
    return extractJsonStringValue(input, 'script') ?? undefined
  }
  return undefined
}

export function parseWorkflowInput(input: string): WorkflowMeta {
  let script = ''
  let name = ''
  try {
    const o = JSON.parse(input) as Record<string, unknown>
    if (typeof o?.script === 'string') script = o.script
    if (typeof o?.name === 'string') name = o.name
  } catch {
    script = extractJsonStringValue(input, 'script') ?? ''
  }
  if (script) return parseWorkflowScript(script)
  return { name, description: '', phases: [] }
}

/**
 * Authoring / compile smoke-check (`validate_only: true`) is not a live
 * multi-agent run. Hosts should render it as a normal tool row, not WorkflowBlock.
 */
export function isWorkflowSmokeCheck(input: string | Record<string, unknown> | undefined | null): boolean {
  if (input == null) return false
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return isWorkflowSmokeCheck(parsed as Record<string, unknown>)
      }
    } catch {
      // Streaming partial JSON: only treat explicit true as smoke (avoid false positives).
      return /"validate_only"\s*:\s*true/.test(input) || /"validateOnly"\s*:\s*true/.test(input)
    }
    return false
  }
  return input.validate_only === true || input.validateOnly === true
}

/** Display label for a workflow tool call (name, script path basename, or meta.name). */
export function workflowToolTargetLabel(input: string | Record<string, unknown> | undefined | null): string {
  if (input == null) return ''
  let o: Record<string, unknown> | null = null
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        o = parsed as Record<string, unknown>
      }
    } catch {
      const namePartial = extractJsonStringValue(input, 'name')
      if (namePartial) return namePartial
      const pathPartial = extractJsonStringValue(input, 'script_path')
        ?? extractJsonStringValue(input, 'scriptPath')
      if (pathPartial) return pathPartial.replace(/\\/g, '/').split('/').pop() || pathPartial
      const scriptPartial = extractJsonStringValue(input, 'script')
      if (scriptPartial) return parseWorkflowScript(scriptPartial).name
      return ''
    }
  } else {
    o = input
  }
  if (!o) return ''
  if (typeof o.name === 'string' && o.name.trim()) return o.name.trim()
  const scriptPath = typeof o.script_path === 'string' ? o.script_path
    : typeof o.scriptPath === 'string' ? o.scriptPath
      : ''
  if (scriptPath) {
    const base = scriptPath.replace(/\\/g, '/').split('/').pop()
    if (base) return base.replace(/\.rhai$/i, '')
  }
  if (typeof o.script === 'string' && o.script) {
    return parseWorkflowScript(o.script).name
  }
  return ''
}

function strField(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return undefined
}

/** Grok stores run artifacts under .../workflows/<run_id>/ (script.rhai, state.json, scratch/). */
export function workflowDirFromScriptPath(scriptPath: string | undefined): string | undefined {
  if (!scriptPath) return undefined
  const normalized = scriptPath.replace(/\\/g, '/')
  const m = normalized.match(/^(.*\/workflows\/[^/]+)\//)
  if (m) return m[1]
  // script.rhai at the workflow root
  if (/\/workflows\/[^/]+\/[^/]+$/.test(normalized)) {
    return normalized.replace(/\/[^/]+$/, '')
  }
  return undefined
}

export function parseWorkflowLaunch(summary?: string): WorkflowLaunchInfo {
  if (!summary) return {}
  const trimmed = summary.trim()
  if (trimmed.startsWith('{')) {
    try {
      const o = JSON.parse(trimmed) as Record<string, unknown>
      if (o && typeof o === 'object') {
        // Claude: camelCase (+ transcriptDir). Grok WorkflowToolOutput: snake_case run_id/task_id + script_path.
        const scriptPath = strField(o, 'scriptPath', 'script_path')
        const explicitDir = strField(o, 'transcriptDir', 'transcript_dir')
        return {
          transcriptDir: explicitDir ?? workflowDirFromScriptPath(scriptPath),
          taskId: strField(o, 'taskId', 'task_id'),
          runId: strField(o, 'runId', 'run_id'),
          scriptPath,
        }
      }
    } catch {
      // fall through to text parsing
    }
  }
  const grab = (label: string) => summary.match(new RegExp(`${label}:\\s*(\\S+)`))?.[1]
  const transcriptDir = grab('Transcript dir')
  const scriptPath = grab('Script file')
  return {
    transcriptDir: transcriptDir ?? workflowDirFromScriptPath(scriptPath),
    taskId: grab('Task ID'),
    runId: grab('Run ID') ?? (transcriptDir ? transcriptDir.split('/').pop() : undefined),
    scriptPath,
  }
}
