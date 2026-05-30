import type { Dag, DagNode, DagEdge } from './workflow-dag'

export interface ReplayAgentRecord {
  agentId: string
  prompt?: string
  label?: string
  result?: unknown
  toolCount?: number
  tokens?: number
}

export interface ReplayResult {
  dag: Dag
  nodeAgentIds: Map<string, string>
  output?: unknown
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>

interface Pending {
  label: string
  prompt?: string
  phase?: string
  subworkflow?: string
  agentId?: string
  toolCount?: number
}

export interface ChildWorkflow {
  source: string
  name?: string
}

function deriveWorkflowName(scriptPath: string): string {
  const base = scriptPath.split('/').pop() ?? scriptPath
  return base.replace(/\.js$/, '').replace(/-wf_[a-z0-9-]+$/i, '')
}

export async function replayWorkflowDag(
  script: string,
  records: ReplayAgentRecord[],
  childScripts: Map<string, ChildWorkflow> = new Map(),
): Promise<ReplayResult | null> {
  const byPrompt = new Map<string, ReplayAgentRecord[]>()
  for (const r of records) {
    const key = r.prompt ?? ''
    const q = byPrompt.get(key)
    if (q) q.push(r)
    else byPrompt.set(key, [r])
  }
  const takeRecord = (prompt: string): ReplayAgentRecord | undefined => byPrompt.get(prompt)?.shift()

  const AGENT_CALL_CAP = 5000
  let agentCalls = 0

  const nodes: DagNode[] = []
  const edges: DagEdge[] = []
  const nodeAgentIds = new Map<string, string>()
  let col = 0
  let prevExit: string[] = []
  let currentPhase: string | undefined
  let currentSubworkflow: string | undefined
  let bucket: Pending[] | null = null

  const connect = (entry: string[]): void => {
    for (const from of prevExit) {
      for (const to of entry) {
        const kind =
          prevExit.length === 1 && entry.length > 1
            ? 'fanout'
            : prevExit.length > 1 && entry.length === 1
              ? 'fanin'
              : 'serial'
        edges.push({ from, to, kind })
      }
    }
  }

  const labelFor = (prompt: string, opts: Record<string, unknown> | undefined, rec?: ReplayAgentRecord): string => {
    const optLabel = opts && typeof opts.label === 'string' ? opts.label : undefined
    return optLabel ?? rec?.label ?? prompt.split('\n')[0].slice(0, 80) ?? 'agent'
  }

  const commitSerial = (p: Pending): void => {
    const id = `n${col}`
    nodes.push({ id, label: p.label, prompt: p.prompt, phase: p.phase, subworkflow: p.subworkflow, group: 'serial', col, row: 0, rows: 1, status: 'done', toolCount: p.toolCount })
    if (p.agentId) nodeAgentIds.set(id, p.agentId)
    connect([id])
    prevExit = [id]
    col++
  }

  const commitParallel = (group: Pending[]): void => {
    if (group.length === 0) return
    const ids = group.map((_, i) => `n${col}-${i}`)
    group.forEach((p, i) => {
      nodes.push({ id: ids[i], label: p.label, prompt: p.prompt, phase: p.phase, subworkflow: p.subworkflow, group: 'parallel', col, row: i, rows: group.length, status: 'done', toolCount: p.toolCount })
      if (p.agentId) nodeAgentIds.set(ids[i], p.agentId)
    })
    connect(ids)
    prevExit = ids
    col++
  }

  const agent = async (prompt: string, opts?: Record<string, unknown>): Promise<unknown> => {
    if (++agentCalls > AGENT_CALL_CAP) throw new Error('workflow replay exceeded agent-call cap')
    const rec = takeRecord(prompt)
    const pending: Pending = {
      label: labelFor(prompt, opts, rec),
      prompt,
      phase: opts && typeof opts.phase === 'string' ? opts.phase : currentPhase,
      subworkflow: currentSubworkflow,
      agentId: rec?.agentId,
      toolCount: rec?.toolCount,
    }
    if (bucket) bucket.push(pending)
    else commitSerial(pending)
    return rec?.result
  }

  const parallel = async (thunks: Array<() => unknown>): Promise<unknown[]> => {
    const outer = bucket
    const local: Pending[] = []
    bucket = local
    let promises: unknown[]
    try {
      promises = Array.isArray(thunks) ? thunks.map((t) => (typeof t === 'function' ? t() : t)) : []
    } finally {
      bucket = outer
    }
    const results = await Promise.all(promises.map((p) => Promise.resolve(p)))
    if (outer) outer.push(...local)
    else commitParallel(local)
    return results
  }

  const pipeline = async (items: unknown[], ...stages: Array<(prev: unknown, item: unknown, i: number) => unknown>): Promise<unknown[]> => {
    const list = Array.isArray(items) ? items : []
    return Promise.all(
      list.map(async (item, i) => {
        let prev: unknown = item
        for (const stage of stages) {
          if (typeof stage !== 'function') continue
          prev = await Promise.resolve(stage(prev, item, i))
        }
        return prev
      }),
    )
  }

  const declaredPhases: string[] = []
  const phase = (title: unknown): void => {
    if (typeof title === 'string') {
      currentPhase = title
      // only top-level phases form the spine; a child workflow's phases stay inside its group
      if (!currentSubworkflow && !declaredPhases.includes(title)) declaredPhases.push(title)
    }
  }
  const log = (): void => {}

  const resolveChild = (nameOrRef: unknown): { child: ChildWorkflow; name: string } | undefined => {
    if (nameOrRef && typeof nameOrRef === 'object' && typeof (nameOrRef as { scriptPath?: unknown }).scriptPath === 'string') {
      const scriptPath = (nameOrRef as { scriptPath: string }).scriptPath
      const child = childScripts.get(scriptPath)
      if (child) return { child, name: child.name ?? deriveWorkflowName(scriptPath) }
    }
    if (typeof nameOrRef === 'string') {
      for (const child of childScripts.values()) {
        if (child.name === nameOrRef) return { child, name: nameOrRef }
      }
    }
    return undefined
  }

  const subworkflowPhases = new Set<string>()
  const workflow = async (nameOrRef: unknown): Promise<unknown> => {
    const resolved = resolveChild(nameOrRef)
    if (!resolved) {
      commitSerial({ label: typeof nameOrRef === 'string' ? nameOrRef : 'workflow', phase: currentPhase, subworkflow: currentSubworkflow })
      return {}
    }
    if (!currentSubworkflow && currentPhase) subworkflowPhases.add(currentPhase)
    const prevSub = currentSubworkflow
    const prevPhase = currentPhase
    currentSubworkflow = resolved.name
    try {
      return await runScript(resolved.child.source)
    } catch {
      return {}
    } finally {
      currentSubworkflow = prevSub
      currentPhase = prevPhase
    }
  }
  const budget = { total: null as number | null, spent: () => 0, remaining: () => Infinity }

  // Lexically shadow host globals so a replayed script cannot reach IPC bridges,
  // the network, or the DOM (it only ever sees the mocked primitives + JS built-ins).
  const SHADOWED = ['window', 'globalThis', 'self', 'global', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'process', 'require', 'importScripts', 'eval']
  const params = ['agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', 'args', 'budget', ...SHADOWED]

  async function runScript(src: string): Promise<unknown> {
    const body = src.replace(/\bexport\s+const\b/g, 'const')
    const fn = new AsyncFunction(...params, body)
    return fn(agent, parallel, pipeline, phase, log, workflow, undefined, budget, ...SHADOWED.map(() => undefined))
  }

  let output: unknown
  try {
    output = await runScript(script)
  } catch {
    // Best-effort: a syntax error or a mid-flow throw still yields the nodes collected so far.
  }

  if (nodes.length === 0) return null
  let maxCol = 0
  for (const n of nodes) maxCol = Math.max(maxCol, n.col)
  const phases = declaredPhases.filter((p) => !subworkflowPhases.has(p))
  return { dag: { nodes, edges, cols: maxCol + 1, phases }, nodeAgentIds, output }
}
