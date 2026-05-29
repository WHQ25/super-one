import type { WorkflowGraph } from './workflow-graph'

export interface DagRuntimeAgent {
  label: string
  status?: 'done' | 'running' | 'failed'
  toolCount?: number
}

export type DagGroup = 'serial' | 'parallel' | 'pipeline' | 'workflow'

export interface DagNode {
  id: string
  label: string
  phase?: string
  group: DagGroup
  col: number
  row: number
  rows: number
  dynamic?: boolean
  status?: 'done' | 'running' | 'failed'
  toolCount?: number
}

export interface DagEdge {
  from: string
  to: string
  kind: 'serial' | 'fanout' | 'fanin'
}

export interface Dag {
  nodes: DagNode[]
  edges: DagEdge[]
  cols: number
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function templateToRegex(tpl: string): RegExp {
  let re = ''
  let i = 0
  while (i < tpl.length) {
    if (tpl.startsWith('${', i)) {
      const end = tpl.indexOf('}', i)
      if (end === -1) { re += escapeRe(tpl.slice(i)); break }
      re += '.+'
      i = end + 1
    } else {
      re += escapeRe(tpl[i])
      i++
    }
  }
  return new RegExp('^' + re + '$')
}

interface Instance {
  label: string
  status?: 'done' | 'running' | 'failed'
  toolCount?: number
}

function expandParallel(
  agents: { label?: string }[],
  dynamic: boolean,
  runtime: DagRuntimeAgent[] | undefined,
): Instance[] {
  if (!runtime || runtime.length === 0) {
    return agents.map((a) => ({ label: a.label ?? 'agent' }))
  }
  const out: Instance[] = []
  for (const spec of agents) {
    const label = spec.label ?? 'agent'
    if (dynamic && label.includes('${')) {
      const re = templateToRegex(label)
      const matched = runtime.filter((r) => re.test(r.label))
      if (matched.length > 0) {
        for (const m of matched) out.push({ label: m.label, status: m.status, toolCount: m.toolCount })
      } else {
        out.push({ label })
      }
    } else {
      const exact = runtime.find((r) => r.label === label)
      out.push({ label, status: exact?.status, toolCount: exact?.toolCount })
    }
  }
  return out
}

export function buildDag(graph: WorkflowGraph, runtime?: DagRuntimeAgent[]): Dag {
  const nodes: DagNode[] = []
  const edges: DagEdge[] = []
  const hasRuntime = !!runtime && runtime.length > 0
  let col = 0
  let prevExit: string[] = []

  const connect = (entry: string[]): void => {
    for (const from of prevExit) {
      for (const to of entry) {
        const kind = prevExit.length === 1 && entry.length > 1
          ? 'fanout'
          : prevExit.length > 1 && entry.length === 1
            ? 'fanin'
            : 'serial'
        edges.push({ from, to, kind })
      }
    }
  }

  for (const block of graph.blocks) {
    if (block.kind === 'agent') {
      const id = `n${col}`
      const rt = hasRuntime ? runtime!.find((r) => r.label === block.agent.label) : undefined
      nodes.push({ id, label: block.agent.label ?? 'agent', phase: block.phase, group: 'serial', col, row: 0, rows: 1, status: rt?.status, toolCount: rt?.toolCount })
      connect([id]); prevExit = [id]; col++
    } else if (block.kind === 'workflow') {
      const id = `n${col}`
      nodes.push({ id, label: block.name ?? 'workflow', phase: block.phase, group: 'workflow', col, row: 0, rows: 1 })
      connect([id]); prevExit = [id]; col++
    } else if (block.kind === 'parallel') {
      const instances = expandParallel(block.agents, block.dynamic, runtime)
      const ids = instances.map((_, i) => `n${col}-${i}`)
      instances.forEach((inst, i) => {
        nodes.push({ id: ids[i], label: inst.label, phase: block.phase, group: 'parallel', col, row: i, rows: instances.length, dynamic: block.dynamic && !hasRuntime, status: inst.status, toolCount: inst.toolCount })
      })
      connect(ids); prevExit = ids; col++
    } else if (block.kind === 'pipeline') {
      const stageSpecs = block.agents.length > 0 ? block.agents : new Array(block.stages).fill({ label: undefined })
      const ids: string[] = []
      stageSpecs.forEach((spec, s) => {
        const id = `n${col}`
        nodes.push({ id, label: spec.label ?? `stage ${s + 1}`, phase: block.phase, group: 'pipeline', col, row: 0, rows: 1, dynamic: block.dynamic })
        if (s === 0) connect([id])
        else edges.push({ from: ids[ids.length - 1], to: id, kind: 'serial' })
        ids.push(id)
        col++
      })
      if (ids.length > 0) prevExit = [ids[ids.length - 1]]
    }
  }

  return { nodes, edges, cols: col }
}
