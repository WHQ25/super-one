import { extractJsonStringValue } from '@superone/shared/partial-json'
import type {
  WorkflowAgentGroup,
  WorkflowAgentRuntimeStatus,
  WorkflowAgentTileStatus,
  WorkflowGroupableAgent,
  WorkflowMeta,
  WorkflowPhase,
  WorkflowPhaseSection,
  WorkflowSubworkflowInfo,
} from './types'

export function strField(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return undefined
}

export function parseJsonObject(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}

export function stripFileUri(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!/^file:\/\//i.test(trimmed)) return trimmed
  let rest = trimmed.replace(/^file:\/\//i, '')
  if (/^localhost\//i.test(rest)) {
    rest = rest.slice('localhost'.length)
  }
  if (/^\/[A-Za-z]:\//.test(rest)) {
    rest = rest.slice(1)
  }
  try {
    return decodeURIComponent(rest)
  } catch {
    return rest
  }
}

export function mergeWorkflowPhaseRows(
  live: WorkflowPhase[] | undefined,
  ...detailSources: Array<WorkflowPhase[] | undefined>
): WorkflowPhase[] {
  const detailByTitle = new Map<string, string>()
  for (const source of detailSources) {
    if (!source?.length) continue
    for (const phase of source) {
      if (phase.detail && !detailByTitle.has(phase.title)) {
        detailByTitle.set(phase.title, phase.detail)
      }
    }
  }
  if (live?.length) {
    return live.map((phase) => ({
      title: phase.title,
      state: phase.state,
      detail: phase.detail ?? detailByTitle.get(phase.title),
    }))
  }
  for (const source of detailSources) {
    if (!source?.length) continue
    return source.map((phase) => ({
      title: phase.title,
      detail: phase.detail ?? detailByTitle.get(phase.title),
      state: phase.state,
    }))
  }
  return []
}

export function stripWorkflowNamePrefix(
  text: string | undefined | null,
  name: string | undefined | null,
): string | undefined {
  if (text == null) return undefined
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const n = name?.trim()
  if (!n) return trimmed
  if (trimmed === n) return undefined
  const prefix = `${n}:`
  if (trimmed.startsWith(prefix)) {
    const rest = trimmed.slice(prefix.length).trim()
    return rest || undefined
  }
  return trimmed
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

export function extractPythonPhaseTitles(script: string): WorkflowPhase[] {
  if (!script) return []
  const phases: WorkflowPhase[] = []
  const seen = new Set<string>()
  let i = 0
  while (i < script.length) {
    const c = script[i]!
    if (c === '#') {
      while (i < script.length && script[i] !== '\n') i += 1
      continue
    }
    if (c === '"' || c === "'") {
      const isTriple = script[i + 1] === c && script[i + 2] === c
      i += isTriple ? 3 : 1
      while (i < script.length) {
        if (script[i] === '\\' && i + 1 < script.length) {
          i += 2
          continue
        }
        if (isTriple) {
          if (script[i] === c && script[i + 1] === c && script[i + 2] === c) {
            i += 3
            break
          }
        } else if (script[i] === c) {
          i += 1
          break
        }
        i += 1
      }
      continue
    }
    if (
      script.startsWith('phase', i)
      && (i === 0 || !/[\w.]/.test(script[i - 1]!))
      && (i + 5 >= script.length || !/\w/.test(script[i + 5]!))
    ) {
      let j = i + 5
      while (j < script.length && /\s/.test(script[j]!)) j += 1
      if (script[j] === '(') {
        j += 1
        while (j < script.length && /\s/.test(script[j]!)) j += 1
        const q = script[j]
        if (q === '"' || q === "'") {
          j += 1
          let title = ''
          while (j < script.length && script[j] !== q && script[j] !== '\n') {
            if (script[j] === '\\' && j + 1 < script.length) {
              title += script[j + 1]!
              j += 2
              continue
            }
            title += script[j]!
            j += 1
          }
          if (script[j] === q) {
            const trimmed = title.trim()
            if (trimmed && !seen.has(trimmed)) {
              seen.add(trimmed)
              phases.push({ title: trimmed })
            }
            i = j + 1
            continue
          }
        }
      }
    }
    i += 1
  }
  return phases
}

export function extractWorkflowScript(input: string): string | undefined {
  const o = parseJsonObject(input)
  if (o) {
    if (typeof o.script === 'string') return o.script
    if (typeof o.Script === 'string') return o.Script
    return undefined
  }
  return extractJsonStringValue(input, 'script')
    ?? extractJsonStringValue(input, 'Script')
    ?? undefined
}

export function extractWorkflowScriptPath(input: string): string | undefined {
  const o = parseJsonObject(input)
  if (o) {
    const source = o.source && typeof o.source === 'object' && !Array.isArray(o.source)
      ? o.source as Record<string, unknown>
      : null
    const p = strField(o, 'script_path', 'scriptPath', 'ScriptPath')
      ?? (source ? strField(source, 'script_path', 'scriptPath') : undefined)
    return p?.trim() || undefined
  }
  return extractJsonStringValue(input, 'script_path')
    ?? extractJsonStringValue(input, 'scriptPath')
    ?? extractJsonStringValue(input, 'ScriptPath')
    ?? undefined
}

export function workflowArtifactPath(workflowDir: string | undefined, fileName: string): string | undefined {
  if (!workflowDir) return undefined
  const base = workflowDir.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!base) return undefined
  return `${base}/${fileName}`
}

export function workflowDirFromScriptPath(scriptPath: string | undefined): string | undefined {
  if (!scriptPath) return undefined
  const normalized = scriptPath.replace(/\\/g, '/')
  const m = normalized.match(/^(.*\/workflows\/[^/]+)\//)
  if (m) return m[1]
  if (/\/workflows\/[^/]+\/[^/]+$/.test(normalized)) {
    return normalized.replace(/\/[^/]+$/, '')
  }
  return undefined
}

export function isWorkflowSmokeCheck(input: string | Record<string, unknown> | undefined | null): boolean {
  if (input == null) return false
  if (typeof input === 'string') {
    const parsed = parseJsonObject(input)
    if (parsed) return isWorkflowSmokeCheck(parsed)
    return /"validate_only"\s*:\s*true/.test(input) || /"validateOnly"\s*:\s*true/.test(input)
  }
  return input.validate_only === true || input.validateOnly === true
}

export function workflowToolTargetLabel(input: string | Record<string, unknown> | undefined | null): string {
  if (input == null) return ''
  let o: Record<string, unknown> | null = null
  if (typeof input === 'string') {
    o = parseJsonObject(input)
    if (!o) {
      const namePartial = extractJsonStringValue(input, 'name')
      if (namePartial) return namePartial
      const pathPartial = extractJsonStringValue(input, 'script_path')
        ?? extractJsonStringValue(input, 'scriptPath')
        ?? extractJsonStringValue(input, 'ScriptPath')
      if (pathPartial) return pathPartial.replace(/\\/g, '/').split('/').pop() || pathPartial
      const scriptPartial = extractJsonStringValue(input, 'script')
        ?? extractJsonStringValue(input, 'Script')
      if (scriptPartial) return parseWorkflowScript(scriptPartial).name
      return ''
    }
  } else {
    o = input
  }
  if (!o) return ''
  const source = o.source && typeof o.source === 'object' && !Array.isArray(o.source)
    ? o.source as Record<string, unknown>
    : null
  const name = strField(o, 'name') ?? (source ? strField(source, 'name') : undefined)
  if (name) return name.trim()
  const scriptPath = strField(o, 'script_path', 'scriptPath', 'ScriptPath')
    ?? (source ? strField(source, 'script_path', 'scriptPath') : undefined)
    ?? ''
  if (scriptPath) {
    const base = scriptPath.replace(/\\/g, '/').split('/').pop()
    if (base) return base.replace(/\.rhai$/i, '')
  }
  const script = typeof o.script === 'string' && o.script
    ? o.script
    : typeof o.Script === 'string' && o.Script
      ? o.Script
      : ''
  if (script) {
    return parseWorkflowScript(script).name
  }
  return ''
}

export function normalizeWorkflowAgentState(state: string | undefined): WorkflowAgentRuntimeStatus | undefined {
  if (!state) return undefined
  const s = state.toLowerCase()
  if (s === 'running' || s === 'active' || s === 'in_progress' || s === 'pending' || s === 'started') return 'running'
  if (s === 'failed' || s === 'error' || s === 'cancelled' || s === 'canceled') return 'failed'
  if (s === 'done' || s === 'completed' || s === 'complete' || s === 'success') return 'done'
  return undefined
}

export function workflowAgentIconClass(
  state: string | undefined,
  workflowRunning: boolean,
  idleClass: string,
  activeClass: string,
): string {
  const status = normalizeWorkflowAgentState(state)
  if (status === 'failed') return `${idleClass} opacity-40`
  if (status === 'running' && workflowRunning) return `${activeClass} animate-pulse`
  return idleClass
}

export function workflowAgentTileStatus(state: string | undefined, workflowRunning: boolean): WorkflowAgentTileStatus {
  const s = state?.toLowerCase()
  if (s === 'pending' || s === 'queued') return workflowRunning ? 'queued' : 'stopped'
  if (s === 'stopped' || s === 'cancelled' || s === 'canceled' || s === 'killed') return 'stopped'
  const status = normalizeWorkflowAgentState(state)
  if (status === 'failed') return 'failed'
  if (status === 'done') return 'done'
  return workflowRunning ? 'running' : status === 'running' ? 'stopped' : 'done'
}

function sectionFor<S extends WorkflowPhaseSection<unknown>>(
  list: S[],
  title: string,
  create: (phase: WorkflowPhase) => S,
): S {
  const found = list.find((s) => s.phase.title === title)
  if (found) return found
  const created = create({ title })
  list.push(created)
  return created
}

export function groupWorkflowAgents<A extends WorkflowGroupableAgent>(
  phases: WorkflowPhase[],
  agents: A[],
  subworkflows: WorkflowSubworkflowInfo[] = [],
): WorkflowAgentGroup<A>[] {
  const groups: WorkflowAgentGroup<A>[] = phases.map((phase) => ({ phase, agents: [], children: [] }))
  const newGroup = (phase: WorkflowPhase): WorkflowAgentGroup<A> => ({ phase, agents: [], children: [] })
  for (const agent of agents) {
    if (!agent.subworkflow) {
      sectionFor(groups, agent.phase ?? '', newGroup).agents.push(agent)
      continue
    }
    const info = subworkflows.find((w) => w.name === agent.subworkflow)
      ?? { name: agent.subworkflow, phases: [] }
    const host = sectionFor(groups, info.hostPhase ?? '', newGroup)
    let child = host.children.find((c) => c.workflow.name === info.name)
    if (!child) {
      child = { workflow: info, sections: info.phases.map((phase) => ({ phase, agents: [] })) }
      host.children.push(child)
    }
    sectionFor(child.sections, agent.phase ?? '', (phase) => ({ phase, agents: [] })).agents.push(agent)
  }
  return groups
}
