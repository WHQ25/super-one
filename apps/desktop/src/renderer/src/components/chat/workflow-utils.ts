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
