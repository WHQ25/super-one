import type { WorkflowGraph, WorkflowBlock, WorkflowAgentSpec, FanoutItem } from './workflow-graph'

export interface DagRuntimeAgent {
  label: string
  prompt?: string
  agentId?: string
  status?: 'done' | 'running' | 'failed'
  toolCount?: number
}

export type DagGroup = 'serial' | 'parallel' | 'pipeline' | 'workflow'

export const NODE_W = 200
export const NODE_H = 86
const PAD = 18
const CLUSTER_PAD = 14
const CLUSTER_LABEL_H = 24
const CLUSTER_GAP = 80
const GRID_GAP = 14
const SUB_PAD = 12
const SUB_LABEL_H = 20
const SUB_SEP = '\u001f'

export const DAG_NODE_SIZE = { w: NODE_W, h: NODE_H }

export interface DagNodeStats { toolCount?: number; tokens?: number }

export interface DagPoint { x: number; y: number; cx: number; cy: number }
export interface DagCluster {
  key: string
  label?: string
  subworkflow?: string
  count: number
  x: number
  y: number
  w: number
  h: number
  cy: number
}

export interface DagSubworkflowBox {
  name: string
  x: number
  y: number
  w: number
  h: number
}

export interface DagLayout {
  width: number
  height: number
  pos: Map<string, DagPoint>
  clusters: DagCluster[]
  subworkflows: DagSubworkflowBox[]
}

function clusterKey(n: DagNode): string {
  const inner = n.phase ? `p:${n.phase}` : `c:${n.col}`
  return n.subworkflow ? `w:${n.subworkflow}${SUB_SEP}${inner}` : inner
}

function parseClusterKey(key: string): { subworkflow?: string; phase?: string } {
  if (key.startsWith('w:')) {
    const sep = key.indexOf(SUB_SEP)
    const inner = key.slice(sep + 1)
    return { subworkflow: key.slice(2, sep), phase: inner.startsWith('p:') ? inner.slice(2) : undefined }
  }
  if (key.startsWith('p:')) return { phase: key.slice(2) }
  return {}
}

export function layoutDag(dag: Dag): DagLayout {
  const order: string[] = []
  const byKey = new Map<string, DagNode[]>()
  const minCol = new Map<string, number>()
  for (const n of dag.nodes) {
    const key = clusterKey(n)
    let arr = byKey.get(key)
    if (!arr) {
      arr = []
      byKey.set(key, arr)
      order.push(key)
      minCol.set(key, n.col)
    }
    arr.push(n)
    minCol.set(key, Math.min(minCol.get(key)!, n.col))
  }
  // Declared phases (every phase() call, even if it spawned no agents) keep a slot so
  // a phase that ran empty still appears as a placeholder cluster, in declared order.
  const declaredKeys = (dag.phases ?? []).map((p) => `p:${p}`)
  const declaredIndex = new Map(declaredKeys.map((k, i) => [k, i] as const))
  const finalOrder = [...new Set([...declaredKeys, ...order])].sort((a, b) => {
    const ia = declaredIndex.has(a) ? declaredIndex.get(a)! : declaredKeys.length + (minCol.get(a) ?? 0)
    const ib = declaredIndex.has(b) ? declaredIndex.get(b)! : declaredKeys.length + (minCol.get(b) ?? 0)
    return ia - ib
  })

  const dims = finalOrder.map((key) => {
    const nodes = [...(byKey.get(key) ?? [])].sort((a, b) => a.col - b.col || a.row - b.row)
    const n = nodes.length
    const gridCols = Math.max(1, Math.ceil(Math.sqrt(n)))
    const gridRows = Math.ceil(n / gridCols)
    const w = CLUSTER_PAD * 2 + gridCols * NODE_W + Math.max(0, gridCols - 1) * GRID_GAP
    const h = CLUSTER_LABEL_H + CLUSTER_PAD * 2 + gridRows * NODE_H + Math.max(0, gridRows - 1) * GRID_GAP
    return { key, nodes, gridCols, w, h, ...parseClusterKey(key) }
  })

  const hasSub = dims.some((d) => d.subworkflow)
  const subTop = hasSub ? SUB_LABEL_H + SUB_PAD : 0
  const maxH = dims.reduce((m, d) => Math.max(m, d.h), CLUSTER_LABEL_H + CLUSTER_PAD * 2 + NODE_H)
  const bandCenter = PAD + subTop + maxH / 2
  const pos = new Map<string, DagPoint>()
  const clusters: DagCluster[] = []
  let x = PAD
  for (const d of dims) {
    const top = bandCenter - d.h / 2
    d.nodes.forEach((node, k) => {
      const gx = k % d.gridCols
      const gy = Math.floor(k / d.gridCols)
      const nx = x + CLUSTER_PAD + gx * (NODE_W + GRID_GAP)
      const ny = top + CLUSTER_LABEL_H + CLUSTER_PAD + gy * (NODE_H + GRID_GAP)
      pos.set(node.id, { x: nx, y: ny, cx: nx + NODE_W / 2, cy: ny + NODE_H / 2 })
    })
    clusters.push({ key: d.key, label: d.phase, subworkflow: d.subworkflow, count: d.nodes.length, x, y: top, w: d.w, h: d.h, cy: top + d.h / 2 })
    x += d.w + CLUSTER_GAP
  }

  const subBounds = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>()
  for (const c of clusters) {
    if (!c.subworkflow) continue
    const b = subBounds.get(c.subworkflow)
    if (!b) subBounds.set(c.subworkflow, { minX: c.x, minY: c.y, maxX: c.x + c.w, maxY: c.y + c.h })
    else {
      b.minX = Math.min(b.minX, c.x)
      b.minY = Math.min(b.minY, c.y)
      b.maxX = Math.max(b.maxX, c.x + c.w)
      b.maxY = Math.max(b.maxY, c.y + c.h)
    }
  }
  const subworkflows: DagSubworkflowBox[] = [...subBounds.entries()].map(([name, b]) => ({
    name,
    x: b.minX - SUB_PAD,
    y: b.minY - SUB_PAD - SUB_LABEL_H,
    w: b.maxX - b.minX + SUB_PAD * 2,
    h: b.maxY - b.minY + SUB_PAD * 2 + SUB_LABEL_H,
  }))

  const width = clusters.length > 0 ? x - CLUSTER_GAP + PAD : PAD * 2 + NODE_W
  const height = bandCenter + maxH / 2 + subTop + PAD
  return { width, height, pos, clusters, subworkflows }
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
  phases?: string[]
  /** Populated when buildDag is given runtime agents (Grok label bind / Claude expansion). */
  nodeAgentIds?: Map<string, string>
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

function templateToCapturingRegex(tpl: string): { re: RegExp; groups: number } {
  let re = ''
  let groups = 0
  let i = 0
  while (i < tpl.length) {
    if (tpl.startsWith('${', i)) {
      const end = tpl.indexOf('}', i)
      if (end === -1) { re += escapeRe(tpl.slice(i)); break }
      re += '([\\s\\S]+?)'
      groups++
      i = end + 1
    } else {
      re += escapeRe(tpl[i])
      i++
    }
  }
  return { re: new RegExp('^' + re + '$'), groups }
}

function pickLabelGroup(caps: string[][], groups: number): number {
  let best = -1
  let bestLen = Infinity
  for (let g = 0; g < groups; g++) {
    const vals = caps.map((c) => c[g] ?? '')
    const varies = vals.some((v) => v !== vals[0])
    const maxLen = vals.reduce((m, v) => Math.max(m, v.length), 0)
    const rank = (varies ? 0 : 1e6) + maxLen
    if (rank < bestLen) { bestLen = rank; best = g }
  }
  return best
}

function deriveInstanceLabel(value: string | undefined): string | undefined {
  if (!value) return undefined
  const first = value.split('\n').find((l) => l.trim().length > 0)?.trim()
  if (!first) return undefined
  return first.length > 40 ? first.slice(0, 39) + '…' : first
}

interface Instance {
  label: string
  prompt?: string
  agentId?: string
  status?: 'done' | 'running' | 'failed'
  toolCount?: number
}

export function promptMatchesTemplate(template: string | undefined, actual: string | undefined): boolean {
  if (!template || !actual) return false
  if (template === actual) return true
  return templateToRegex(template).test(actual)
}

/**
 * Match a graph label template to a runtime agent label.
 * Supports exact match, JS-style `${…}`, and Rhai harvested wildcards (`scan:*`, `scan:`).
 */
export function labelMatchesTemplate(template: string | undefined, actual: string | undefined): boolean {
  if (!template || !actual) return false
  if (template === actual) return true
  if (template.includes('${')) return templateToRegex(template).test(actual)
  if (template.endsWith('*')) return actual.startsWith(template.slice(0, -1))
  if (template.endsWith(':')) return actual.startsWith(template)
  return false
}

function isDynamicLabelTemplate(label: string | undefined): boolean {
  if (!label) return false
  return label.includes('${') || label.endsWith('*') || label.endsWith(':')
}

export function assignAgentsToNodes(
  nodes: { id: string; prompt?: string; label?: string }[],
  agents: { agentId: string; prompt?: string; label?: string }[],
): Map<string, string> {
  const map = new Map<string, string>()
  const used = new Set<string>()
  const assign = (node: { id: string }, agentId: string): void => {
    map.set(node.id, agentId)
    used.add(agentId)
  }

  // 1) Exact prompt (Claude static + expanded fan-out)
  for (const node of nodes) {
    if (!node.prompt) continue
    const hit = agents.find((a) => !used.has(a.agentId) && a.prompt !== undefined && a.prompt === node.prompt)
    if (hit) assign(node, hit.agentId)
  }
  // 2) Template prompt
  for (const node of nodes) {
    if (map.has(node.id) || !node.prompt) continue
    const hit = agents.find((a) => !used.has(a.agentId) && promptMatchesTemplate(node.prompt, a.prompt))
    if (hit) assign(node, hit.agentId)
  }
  // 3) Exact label (Grok serial agents — Rhai rarely embeds prompt literals)
  for (const node of nodes) {
    if (map.has(node.id) || !node.label) continue
    const hit = agents.find((a) => !used.has(a.agentId) && a.label !== undefined && a.label === node.label)
    if (hit) assign(node, hit.agentId)
  }
  // 4) Dynamic / wildcard labels (catalog:* ↔ catalog:tools)
  for (const node of nodes) {
    if (map.has(node.id) || !node.label) continue
    const hit = agents.find((a) => !used.has(a.agentId) && labelMatchesTemplate(node.label, a.label))
    if (hit) assign(node, hit.agentId)
  }
  return map
}

function substituteTemplate(tpl: string, params: string[], values: (FanoutItem | number)[]): string {
  const scope: Record<string, unknown> = {}
  params.forEach((p, idx) => { scope[p] = values[idx] })
  return tpl.replace(/\$\{([^}]+)\}/g, (whole, expr) => {
    const path = String(expr).trim().split('.')
    if (!(path[0] in scope)) return whole
    let cur: unknown = scope[path[0]]
    for (let i = 1; i < path.length && cur != null; i++) {
      cur = typeof cur === 'object' ? (cur as Record<string, unknown>)[path[i]] : undefined
    }
    return cur === undefined || cur === null ? whole : String(cur)
  })
}

function expandParallel(
  block: { agents: WorkflowAgentSpec[]; dynamic: boolean; items?: FanoutItem[]; mapParams?: string[] },
  runtime: DagRuntimeAgent[] | undefined,
  consumed: Set<number>,
): Instance[] {
  const { agents, dynamic, items, mapParams } = block
  const hasRuntime = !!runtime && runtime.length > 0

  if (items && items.length > 0 && agents.length > 0) {
    const out: Instance[] = []
    for (const spec of agents) {
      items.forEach((item, idx) => {
        const label = substituteTemplate(spec.label ?? 'agent', mapParams ?? [], [item, idx])
        const prompt = spec.prompt ? substituteTemplate(spec.prompt, mapParams ?? [], [item, idx]) : undefined
        const rt = hasRuntime ? takeOneRuntime(runtime!, consumed, prompt, label) : undefined
        // Keep AST/substituted labels for stable display; decorate with runtime stats.
        out.push({
          label,
          prompt: rt?.prompt ?? prompt,
          agentId: rt?.agentId,
          status: rt?.status,
          toolCount: rt?.toolCount,
        })
      })
    }
    return out
  }

  if (!runtime || runtime.length === 0) {
    return agents.map((a) => ({ label: a.label ?? 'agent', prompt: a.prompt }))
  }
  const out: Instance[] = []
  for (const spec of agents) {
    const labelTpl = spec.label
    const promptTpl = spec.prompt
    // Dynamic fan-out: JS `${…}` templates or Rhai harvested wildcards (scan:*, scan:).
    if (dynamic && isDynamicLabelTemplate(labelTpl)) {
      const matched = takeMatching(runtime, consumed, (r) => labelMatchesTemplate(labelTpl, r.label))
      if (matched.length > 0) {
        for (const m of matched) {
          out.push({
            label: m.label,
            prompt: m.prompt ?? promptTpl,
            agentId: m.agentId,
            status: m.status,
            toolCount: m.toolCount,
          })
        }
      } else {
        out.push({ label: labelTpl!, prompt: promptTpl })
      }
    } else if (dynamic && promptTpl && promptTpl.includes('${')) {
      const { re, groups } = templateToCapturingRegex(promptTpl)
      const hits: { agent: DagRuntimeAgent; index: number; caps: string[] }[] = []
      runtime.forEach((r, index) => {
        if (consumed.has(index) || r.prompt === undefined) return
        const m = re.exec(r.prompt)
        if (m) hits.push({ agent: r, index, caps: m.slice(1) })
      })
      if (hits.length > 0) {
        const labelIdx = pickLabelGroup(hits.map((h) => h.caps), groups)
        for (const h of hits) {
          consumed.add(h.index)
          const derived = labelIdx >= 0 ? deriveInstanceLabel(h.caps[labelIdx]) : undefined
          out.push({
            label: derived ?? labelTpl ?? 'agent',
            prompt: h.agent.prompt,
            agentId: h.agent.agentId,
            status: h.agent.status,
            toolCount: h.agent.toolCount,
          })
        }
      } else {
        out.push({ label: labelTpl ?? 'agent', prompt: promptTpl })
      }
    } else {
      const label = labelTpl ?? 'agent'
      // Prefer exact label; fall back to wildcard-style match for a single node.
      let idx = runtime.findIndex((r, i) => !consumed.has(i) && r.label === label)
      if (idx < 0 && isDynamicLabelTemplate(label)) {
        idx = runtime.findIndex((r, i) => !consumed.has(i) && labelMatchesTemplate(label, r.label))
      }
      const exact = idx >= 0 ? runtime[idx] : undefined
      if (idx >= 0) consumed.add(idx)
      out.push({
        label: exact?.label ?? label,
        prompt: exact?.prompt ?? promptTpl,
        agentId: exact?.agentId,
        status: exact?.status,
        toolCount: exact?.toolCount,
      })
    }
  }
  // Catch remaining runtime agents in this parallel phase that share no template —
  // only when the block was dynamic and produced at least one matched instance already
  // (avoids inventing nodes when the graph has no label pattern).
  return out
}

function takeMatching(
  runtime: DagRuntimeAgent[],
  consumed: Set<number>,
  pred: (r: DagRuntimeAgent) => boolean,
): DagRuntimeAgent[] {
  const out: DagRuntimeAgent[] = []
  runtime.forEach((r, i) => {
    if (consumed.has(i) || !pred(r)) return
    consumed.add(i)
    out.push(r)
  })
  return out
}

function takeOneRuntime(
  runtime: DagRuntimeAgent[],
  consumed: Set<number>,
  prompt: string | undefined,
  label: string,
): DagRuntimeAgent | undefined {
  let idx = -1
  if (prompt !== undefined) {
    idx = runtime.findIndex((r, i) => !consumed.has(i) && r.prompt === prompt)
    if (idx < 0 && prompt.includes('${')) {
      const re = templateToCapturingRegex(prompt).re
      idx = runtime.findIndex((r, i) => !consumed.has(i) && r.prompt !== undefined && re.test(r.prompt))
    }
  }
  if (idx < 0) idx = runtime.findIndex((r, i) => !consumed.has(i) && r.label === label)
  if (idx < 0 && isDynamicLabelTemplate(label)) {
    idx = runtime.findIndex((r, i) => !consumed.has(i) && labelMatchesTemplate(label, r.label))
  }
  if (idx < 0) return undefined
  consumed.add(idx)
  return runtime[idx]
}

function matchAgentRuntime(
  spec: WorkflowAgentSpec,
  runtime: DagRuntimeAgent[],
  consumed: Set<number>,
): DagRuntimeAgent | undefined {
  let idx = spec.label ? runtime.findIndex((r, i) => !consumed.has(i) && r.label === spec.label) : -1
  if (idx < 0 && spec.label && isDynamicLabelTemplate(spec.label)) {
    idx = runtime.findIndex((r, i) => !consumed.has(i) && labelMatchesTemplate(spec.label, r.label))
  }
  if (idx < 0 && spec.prompt) {
    const re = spec.prompt.includes('${') ? templateToCapturingRegex(spec.prompt).re : undefined
    idx = runtime.findIndex((r, i) =>
      !consumed.has(i) && r.prompt !== undefined && (re ? re.test(r.prompt) : r.prompt === spec.prompt),
    )
  }
  if (idx < 0) return undefined
  consumed.add(idx)
  return runtime[idx]
}

/** Map Grok/live agent state strings onto DAG status chips. */
export function runtimeStatusFromAgentState(state: string | undefined): DagRuntimeAgent['status'] {
  if (!state) return undefined
  const s = state.toLowerCase()
  if (s === 'running' || s === 'active' || s === 'in_progress' || s === 'pending') return 'running'
  if (s === 'failed' || s === 'error' || s === 'cancelled' || s === 'canceled') return 'failed'
  if (s === 'done' || s === 'completed' || s === 'complete' || s === 'success') return 'done'
  return undefined
}

/**
 * After buildDag(…, runtime), prefer agentIds carried through expansion when present;
 * fill remaining nodes via prompt/label assignment.
 */
export function bindAgentsToDag(
  dag: Dag,
  agents: Array<{ agentId: string; prompt?: string; label?: string }>,
  prebound?: Map<string, string>,
): Map<string, string> {
  const map = new Map(prebound ?? [])
  const used = new Set(map.values())
  const remainingNodes = dag.nodes.filter((n) => !map.has(n.id))
  const remainingAgents = agents.filter((a) => !used.has(a.agentId))
  for (const [nodeId, agentId] of assignAgentsToNodes(remainingNodes, remainingAgents)) {
    map.set(nodeId, agentId)
  }
  return map
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

function collectLabelCandidates(graph: WorkflowGraph, out: { label: string; phase?: string }[]): void {
  for (const block of graph.blocks) {
    if (block.kind === 'agent') {
      if (block.agent.label) out.push({ label: block.agent.label, phase: block.phase })
    } else if (block.kind === 'parallel' || block.kind === 'pipeline') {
      for (const a of block.agents) {
        if (a.label) out.push({ label: a.label, phase: block.phase })
      }
    } else if (block.kind === 'workflow' && block.child) {
      collectLabelCandidates(block.child, out)
    }
  }
}

/** Match runtime agent label to a script graph phase (Grok often has labels without prompt templates). */
export function agentPhaseByLabel(graph: WorkflowGraph, label: string | undefined): string | undefined {
  if (!label) return undefined
  const candidates: { label: string; phase?: string }[] = []
  collectLabelCandidates(graph, candidates)
  const exact = candidates.find((c) => c.label === label)
  if (exact) return exact.phase
  // Dynamic labels like "scan:ui-sidebar" vs graph "scan:*" / "scan:"
  for (const c of candidates) {
    if (c.label.endsWith('*') && label.startsWith(c.label.slice(0, -1))) return c.phase
    if (c.label.endsWith(':') && label.startsWith(c.label)) return c.phase
  }
  return undefined
}

/** Prefer live phase, then prompt match, then label match. */
export function resolveAgentPhase(
  graph: WorkflowGraph | null | undefined,
  agent: { phase?: string; prompt?: string; label?: string },
): string | undefined {
  if (agent.phase) return agent.phase
  if (!graph) return undefined
  return agentPhaseByPrompt(graph, agent.prompt) ?? agentPhaseByLabel(graph, agent.label)
}

export function buildDag(graph: WorkflowGraph, runtime?: DagRuntimeAgent[]): Dag {
  const nodes: DagNode[] = []
  const edges: DagEdge[] = []
  const hasRuntime = !!runtime && runtime.length > 0
  const consumed = new Set<number>()
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

  /** nodeId → agentId collected while expanding with runtime (Grok / Claude). */
  const boundAgentIds = new Map<string, string>()

  const processBlock = (block: WorkflowBlock, subworkflow?: string): void => {
    if (block.kind === 'agent') {
      const id = `n${col}`
      const rt = hasRuntime ? matchAgentRuntime(block.agent, runtime!, consumed) : undefined
      nodes.push({
        id,
        label: block.agent.label ?? rt?.label ?? 'agent',
        prompt: block.agent.prompt ?? rt?.prompt,
        phase: block.phase,
        group: 'serial',
        col,
        row: 0,
        rows: 1,
        status: rt?.status,
        toolCount: rt?.toolCount,
        subworkflow,
      })
      if (rt?.agentId) boundAgentIds.set(id, rt.agentId)
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
      const instances = expandParallel(block, runtime, consumed)
      const staticExpanded = !!block.items && block.items.length > 0
      const ids = instances.map((_, i) => `n${col}-${i}`)
      instances.forEach((inst, i) => {
        nodes.push({
          id: ids[i],
          label: inst.label,
          prompt: inst.prompt,
          phase: block.phase,
          group: 'parallel',
          col,
          row: i,
          rows: instances.length,
          dynamic: block.dynamic && !hasRuntime && !staticExpanded,
          status: inst.status,
          toolCount: inst.toolCount,
          subworkflow,
        })
        if (inst.agentId) boundAgentIds.set(ids[i], inst.agentId)
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

  return {
    nodes,
    edges,
    cols: col,
    phases: graph.phases,
    ...(boundAgentIds.size > 0 ? { nodeAgentIds: boundAgentIds } : {}),
  }
}
