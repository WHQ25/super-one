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

export function parseWorkflowLaunch(summary?: string): WorkflowLaunchInfo {
  if (!summary) return {}
  const trimmed = summary.trim()
  if (trimmed.startsWith('{')) {
    try {
      const o = JSON.parse(trimmed) as Record<string, unknown>
      if (o && typeof o === 'object') {
        return {
          transcriptDir: typeof o.transcriptDir === 'string' ? o.transcriptDir : undefined,
          taskId: typeof o.taskId === 'string' ? o.taskId : undefined,
          runId: typeof o.runId === 'string' ? o.runId : undefined,
          scriptPath: typeof o.scriptPath === 'string' ? o.scriptPath : undefined,
        }
      }
    } catch {
      // fall through to text parsing
    }
  }
  const grab = (label: string) => summary.match(new RegExp(`${label}:\\s*(\\S+)`))?.[1]
  const transcriptDir = grab('Transcript dir')
  return {
    transcriptDir,
    taskId: grab('Task ID'),
    runId: grab('Run ID') ?? (transcriptDir ? transcriptDir.split('/').pop() : undefined),
    scriptPath: grab('Script file'),
  }
}
