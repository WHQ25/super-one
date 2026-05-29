import type { WorkflowGraph, WorkflowBlock, WorkflowAgentSpec } from './workflow-graph'

export interface DagRuntimeAgent {
  label: string
  status?: 'done' | 'running' | 'failed'
  toolCount?: number
}

export type DagGroup = 'serial' | 'parallel' | 'pipeline' | 'workflow'

export const NODE_W = 200
export const NODE_H = 86
const COL_GAP = 48
const ROW_GAP = 18
const PAD = 18
const GROUP_PAD = 8
const GROUP_LABEL_H = 18

export const DAG_NODE_SIZE = { w: NODE_W, h: NODE_H }

export interface DagNodeStats { toolCount?: number; tokens?: number }

export interface DagPoint { x: number; y: number; cx: number; cy: number }
export interface DagLayout {
  width: number
  height: number
  pos: Map<string, DagPoint>
  groups: { name: string; x: number; y: number; w: number; h: number }[]
}

export function layoutDag(dag: Dag): DagLayout {
  const hasGroups = dag.nodes.some((n) => n.subworkflow)
  const topMargin = hasGroups ? GROUP_LABEL_H : 0
  const maxRows = dag.nodes.reduce((m, n) => Math.max(m, n.rows), 1)
  const contentH = maxRows * NODE_H + (maxRows - 1) * ROW_GAP
  const height = contentH + PAD * 2 + topMargin
  const width = PAD * 2 + Math.max(1, dag.cols) * NODE_W + Math.max(0, dag.cols - 1) * COL_GAP
  const bandCenter = PAD + topMargin + contentH / 2
  const pos = new Map<string, DagPoint>()
  for (const n of dag.nodes) {
    const groupH = n.rows * NODE_H + (n.rows - 1) * ROW_GAP
    const x = PAD + n.col * (NODE_W + COL_GAP)
    const y = bandCenter - groupH / 2 + n.row * (NODE_H + ROW_GAP)
    pos.set(n.id, { x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2 })
  }
  const groupOrder: string[] = []
  const bounds = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>()
  for (const n of dag.nodes) {
    if (!n.subworkflow) continue
    const p = pos.get(n.id)!
    if (!bounds.has(n.subworkflow)) {
      groupOrder.push(n.subworkflow)
      bounds.set(n.subworkflow, { minX: p.x, minY: p.y, maxX: p.x + NODE_W, maxY: p.y + NODE_H })
    } else {
      const b = bounds.get(n.subworkflow)!
      b.minX = Math.min(b.minX, p.x)
      b.minY = Math.min(b.minY, p.y)
      b.maxX = Math.max(b.maxX, p.x + NODE_W)
      b.maxY = Math.max(b.maxY, p.y + NODE_H)
    }
  }
  const groups = groupOrder.map((name) => {
    const b = bounds.get(name)!
    return { name, x: b.minX - GROUP_PAD, y: b.minY - GROUP_PAD, w: b.maxX - b.minX + GROUP_PAD * 2, h: b.maxY - b.minY + GROUP_PAD * 2 }
  })
  return { width, height, pos, groups }
}

export function measureDag(dag: Dag): { width: number; height: number } {
  const { width, height } = layoutDag(dag)
  return { width, height }
}

export interface DagNode {
  id: string
  label: string
  prompt?: string
  phase?: string
  group: DagGroup
  col: number
  row: number
  rows: number
  dynamic?: boolean
  status?: 'done' | 'running' | 'failed'
  toolCount?: number
  subworkflow?: string
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
  prompt?: string
  status?: 'done' | 'running' | 'failed'
  toolCount?: number
}

export function promptMatchesTemplate(template: string | undefined, actual: string | undefined): boolean {
  if (!template || !actual) return false
  if (template === actual) return true
  return templateToRegex(template).test(actual)
}

export function assignAgentsToNodes(
  nodes: { id: string; prompt?: string }[],
  agents: { agentId: string; prompt?: string }[],
): Map<string, string> {
  const map = new Map<string, string>()
  const used = new Set<string>()
  const candidates = nodes.filter((n) => n.prompt)
  const assign = (node: { id: string }, agentId: string): void => {
    map.set(node.id, agentId)
    used.add(agentId)
  }
  for (const node of candidates) {
    const hit = agents.find((a) => !used.has(a.agentId) && a.prompt !== undefined && a.prompt === node.prompt)
    if (hit) assign(node, hit.agentId)
  }
  for (const node of candidates) {
    if (map.has(node.id)) continue
    const hit = agents.find((a) => !used.has(a.agentId) && promptMatchesTemplate(node.prompt, a.prompt))
    if (hit) assign(node, hit.agentId)
  }
  return map
}

function substituteTemplate(tpl: string, params: string[], values: (string | number)[]): string {
  let out = tpl
  params.forEach((p, idx) => {
    if (values[idx] === undefined) return
    out = out.split('${' + p + '}').join(String(values[idx]))
  })
  return out
}

function expandParallel(
  block: { agents: WorkflowAgentSpec[]; dynamic: boolean; items?: string[]; mapParams?: string[] },
  runtime: DagRuntimeAgent[] | undefined,
): Instance[] {
  const { agents, dynamic, items, mapParams } = block
  if (!runtime || runtime.length === 0) {
    if (items && items.length > 0 && agents.length > 0) {
      const out: Instance[] = []
      for (const spec of agents) {
        items.forEach((item, idx) => {
          out.push({
            label: substituteTemplate(spec.label ?? 'agent', mapParams ?? [], [item, idx]),
            prompt: spec.prompt ? substituteTemplate(spec.prompt, mapParams ?? [], [item, idx]) : undefined,
          })
        })
      }
      return out
    }
    return agents.map((a) => ({ label: a.label ?? 'agent', prompt: a.prompt }))
  }
  const out: Instance[] = []
  for (const spec of agents) {
    const label = spec.label ?? 'agent'
    if (dynamic && label.includes('${')) {
      const re = templateToRegex(label)
      const matched = runtime.filter((r) => re.test(r.label))
      if (matched.length > 0) {
        for (const m of matched) out.push({ label: m.label, prompt: spec.prompt, status: m.status, toolCount: m.toolCount })
      } else {
        out.push({ label, prompt: spec.prompt })
      }
    } else {
      const exact = runtime.find((r) => r.label === label)
      out.push({ label, prompt: spec.prompt, status: exact?.status, toolCount: exact?.toolCount })
    }
  }
  return out
}

function collectPromptCandidates(graph: WorkflowGraph, out: { tpl: string; phase?: string }[]): void {
  for (const block of graph.blocks) {
    if (block.kind === 'agent') {
      if (block.agent.prompt) out.push({ tpl: block.agent.prompt, phase: block.phase })
    } else if (block.kind === 'parallel' || block.kind === 'pipeline') {
      for (const a of block.agents) if (a.prompt) out.push({ tpl: a.prompt, phase: block.phase })
    } else if (block.kind === 'workflow' && block.child) {
      collectPromptCandidates(block.child, out)
    }
  }
}

export function agentPhaseByPrompt(graph: WorkflowGraph, prompt: string | undefined): string | undefined {
  if (!prompt) return undefined
  const candidates: { tpl: string; phase?: string }[] = []
  collectPromptCandidates(graph, candidates)
  for (const c of candidates) {
    if (templateToRegex(c.tpl).test(prompt)) return c.phase
  }
  return undefined
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

  const processBlock = (block: WorkflowBlock, subworkflow?: string): void => {
    if (block.kind === 'agent') {
      const id = `n${col}`
      const rt = hasRuntime ? runtime!.find((r) => r.label === block.agent.label) : undefined
      nodes.push({ id, label: block.agent.label ?? 'agent', prompt: block.agent.prompt, phase: block.phase, group: 'serial', col, row: 0, rows: 1, status: rt?.status, toolCount: rt?.toolCount, subworkflow })
      connect([id]); prevExit = [id]; col++
    } else if (block.kind === 'workflow') {
      if (block.child && block.child.blocks.length > 0) {
        for (const childBlock of block.child.blocks) processBlock(childBlock, block.name ?? subworkflow)
        return
      }
      const id = `n${col}`
      nodes.push({ id, label: block.name ?? 'workflow', phase: block.phase, group: 'workflow', col, row: 0, rows: 1, subworkflow })
      connect([id]); prevExit = [id]; col++
    } else if (block.kind === 'parallel') {
      const instances = expandParallel(block, runtime)
      const staticExpanded = !hasRuntime && !!block.items && block.items.length > 0
      const ids = instances.map((_, i) => `n${col}-${i}`)
      instances.forEach((inst, i) => {
        nodes.push({ id: ids[i], label: inst.label, prompt: inst.prompt, phase: block.phase, group: 'parallel', col, row: i, rows: instances.length, dynamic: block.dynamic && !hasRuntime && !staticExpanded, status: inst.status, toolCount: inst.toolCount, subworkflow })
      })
      connect(ids); prevExit = ids; col++
    } else if (block.kind === 'pipeline') {
      const stageSpecs = block.agents.length > 0 ? block.agents : new Array(block.stages).fill({ label: undefined })
      if (block.items && block.items.length > 0 && stageSpecs.length > 0) {
        const rows = block.items.length
        const startCol = col
        const grid: string[][] = block.items.map(() => [])
        stageSpecs.forEach((spec, s) => {
          const stageCol = startCol + s
          const param = block.stageItemParams?.[s]
          const stageIds: string[] = []
          block.items!.forEach((item, r) => {
            const id = `n${stageCol}-${r}`
            const label = param ? substituteTemplate(spec.label ?? `stage ${s + 1}`, [param], [item]) : (spec.label ?? `stage ${s + 1}`)
            const prompt = param && spec.prompt ? substituteTemplate(spec.prompt, [param], [item]) : spec.prompt
            nodes.push({ id, label, prompt, phase: block.phase, group: 'pipeline', col: stageCol, row: r, rows, subworkflow })
            if (s > 0) edges.push({ from: grid[r][s - 1], to: id, kind: 'serial' })
            grid[r].push(id)
            stageIds.push(id)
          })
          if (s === 0) connect(stageIds)
        })
        col = startCol + stageSpecs.length
        prevExit = grid.map((row) => row[row.length - 1])
      } else {
        const ids: string[] = []
        stageSpecs.forEach((spec, s) => {
          const id = `n${col}`
          nodes.push({ id, label: spec.label ?? `stage ${s + 1}`, prompt: spec.prompt, phase: block.phase, group: 'pipeline', col, row: 0, rows: 1, dynamic: block.dynamic, subworkflow })
          if (s === 0) connect([id])
          else edges.push({ from: ids[ids.length - 1], to: id, kind: 'serial' })
          ids.push(id)
          col++
        })
        if (ids.length > 0) prevExit = [ids[ids.length - 1]]
      }
    }
  }

  for (const block of graph.blocks) processBlock(block)

  return { nodes, edges, cols: col }
}
