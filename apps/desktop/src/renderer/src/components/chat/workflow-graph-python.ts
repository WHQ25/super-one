import type { FanoutItem, WorkflowAgentSpec, WorkflowBlock, WorkflowGraph } from './workflow-graph'
import {
  balancedSlice,
  isStringPrefixStart,
  parsePythonListItems,
  parsePythonStringExpr,
  skipPythonString,
  splitKeywordArg,
  splitTopLevelArgs,
  stripPythonComments,
} from './workflow-graph-python-lexer'

function extractPythonAgentSpec(callBody: string, consts: Map<string, string>): WorkflowAgentSpec {
  const args = splitTopLevelArgs(callBody)
  let prompt: string | undefined
  let label: string | undefined
  let agentType: string | undefined
  let model: string | undefined

  args.forEach((arg, index) => {
    const kw = splitKeywordArg(arg)
    if (!kw) {
      if (index === 0) prompt = parsePythonStringExpr(arg, consts)
      return
    }
    if (kw.key === 'prompt') prompt = parsePythonStringExpr(kw.value, consts)
    else if (kw.key === 'role' || kw.key === 'label') label = parsePythonStringExpr(kw.value, consts)
    else if (kw.key === 'type_name' || kw.key === 'agent_type') agentType = parsePythonStringExpr(kw.value, consts)
    else if (kw.key === 'model') model = parsePythonStringExpr(kw.value, consts)
  })

  return { label, prompt, agentType, model }
}

function findPythonAgentsInExpr(src: string, consts: Map<string, string>): WorkflowAgentSpec[] {
  const agents: WorkflowAgentSpec[] = []
  let i = 0
  while (i < src.length) {
    if (isStringPrefixStart(src, i)) {
      i = skipPythonString(src, i)
      continue
    }
    if (
      src.startsWith('agent', i)
      && (i === 0 || !/[\w.]/.test(src[i - 1]!))
      && (i + 5 >= src.length || !/\w/.test(src[i + 5]!))
    ) {
      let j = i + 5
      while (j < src.length && /\s/.test(src[j]!)) j += 1
      if (src[j] === '(') {
        const call = balancedSlice(src, j)
        if (call) {
          agents.push(extractPythonAgentSpec(call.slice(1, -1), consts))
          i = j + call.length
          continue
        }
      }
    }
    i += 1
  }
  return agents
}

interface PythonDefInfo {
  name: string
  params: string[]
  body: string
  start: number
  end: number
}

function collectPythonDefs(src: string): Map<string, PythonDefInfo> {
  const defs = new Map<string, PythonDefInfo>()
  const lines = src.split('\n')
  const offsets: number[] = []
  let pos = 0
  for (const line of lines) {
    offsets.push(pos)
    pos += line.length + 1
  }
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx]!
    const m = line.match(/^([ \t]*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->[^:]+)?\s*:/)
    if (!m) continue
    const indent = m[1]!.length
    const name = m[2]!
    const params = m[3]!
      .split(',')
      .map((p) => p.trim().split(/[:=]/)[0]?.trim() ?? '')
      .filter((p) => /^[A-Za-z_]\w*$/.test(p))
    let endIdx = idx + 1
    while (endIdx < lines.length) {
      const next = lines[endIdx]!
      if (next.trim() === '') {
        endIdx += 1
        continue
      }
      const nextIndent = next.match(/^[ \t]*/)?.[0].length ?? 0
      if (nextIndent <= indent) break
      endIdx += 1
    }
    const startOffset = offsets[idx]!
    const endOffset = endIdx < lines.length ? offsets[endIdx]! : src.length
    const body = lines.slice(idx + 1, endIdx).join('\n')
    defs.set(name, { name, params, body, start: startOffset, end: endOffset })
  }
  return defs
}

function collectPythonTopLevelConsts(src: string): {
  strings: Map<string, string>
  lists: Map<string, FanoutItem[]>
} {
  const strings = new Map<string, string>()
  const lists = new Map<string, FanoutItem[]>()
  const lines = src.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const m = line.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/)
    if (!m) {
      i += 1
      continue
    }
    const name = m[1]!
    let rhs = m[2]!.trim()
    if (rhs.startsWith('[') && !rhs.endsWith(']')) {
      let j = i + 1
      while (j < lines.length && !rhs.includes(']')) {
        rhs += `\n${lines[j]!}`
        j += 1
      }
      i = j
    } else {
      i += 1
    }
    const str = parsePythonStringExpr(rhs, strings)
    if (str !== undefined) {
      strings.set(name, str)
      continue
    }
    const arr = parsePythonListItems(rhs, lists)
    if (arr) lists.set(name, arr)
  }
  return { strings, lists }
}

function parseLambdaCallback(
  expr: string,
  consts: Map<string, string>,
  defs: Map<string, PythonDefInfo>,
): { params: string[]; agents: WorkflowAgentSpec[] } {
  const trimmed = expr.trim()
  const lam = trimmed.match(/^lambda\s+([^:]+):([\s\S]+)$/)
  if (lam) {
    const params = lam[1]!
      .split(',')
      .map((p) => p.trim().split('=')[0]?.trim() ?? '')
      .filter((p) => /^[A-Za-z_]\w*$/.test(p))
    return { params, agents: findPythonAgentsInExpr(lam[2]!, consts) }
  }
  if (/^[A-Za-z_]\w*$/.test(trimmed)) {
    const def = defs.get(trimmed)
    if (def) {
      return { params: def.params, agents: findPythonAgentsInExpr(def.body, consts) }
    }
  }
  return { params: [], agents: findPythonAgentsInExpr(trimmed, consts) }
}

export function parsePythonWorkflowGraph(script: string): WorkflowGraph {
  const phases: string[] = []
  const blocks: WorkflowBlock[] = []
  if (!script) return { phases, blocks }

  const src = stripPythonComments(script)
  const defs = collectPythonDefs(src)
  const defRanges = [...defs.values()].map((d) => ({ start: d.start, end: d.end }))
  const isInsideDef = (idx: number) => defRanges.some((r) => idx >= r.start && idx < r.end)
  const { strings: consts, lists } = collectPythonTopLevelConsts(src)

  type Hit =
    | { kind: 'phase'; index: number; end: number; title: string }
    | { kind: 'call'; index: number; end: number; name: 'agent' | 'parallel' | 'pipeline'; args: string }

  const hits: Hit[] = []
  let i = 0
  while (i < src.length) {
    if (isStringPrefixStart(src, i)) {
      i = skipPythonString(src, i)
      continue
    }
    if (isInsideDef(i)) {
      i += 1
      continue
    }
    let matched = false
    for (const name of ['phase', 'parallel', 'pipeline', 'agent'] as const) {
      if (!src.startsWith(name, i)) continue
      if (i > 0 && /[\w.]/.test(src[i - 1]!)) continue
      const after = i + name.length
      if (after < src.length && /\w/.test(src[after]!)) continue
      let j = after
      while (j < src.length && /\s/.test(src[j]!)) j += 1
      if (src[j] !== '(') continue
      const call = balancedSlice(src, j)
      if (!call) continue
      const inner = call.slice(1, -1)
      if (name === 'phase') {
        const firstArg = splitTopLevelArgs(inner)[0] ?? ''
        const title = parsePythonStringExpr(firstArg, consts)
        if (title) {
          hits.push({ kind: 'phase', index: i, end: j + call.length, title })
        }
      } else {
        const nested = hits.some((h) => h.kind === 'call' && i > h.index && i < h.end)
        if (!nested) {
          hits.push({ kind: 'call', index: i, end: j + call.length, name, args: inner })
        }
      }
      i = j + call.length
      matched = true
      break
    }
    if (!matched) i += 1
  }

  let currentPhase: string | undefined
  for (const hit of hits) {
    if (hit.kind === 'phase') {
      currentPhase = hit.title
      if (!phases.includes(hit.title)) phases.push(hit.title)
      continue
    }
    if (hit.name === 'agent') {
      blocks.push({
        kind: 'agent',
        phase: currentPhase,
        agent: extractPythonAgentSpec(hit.args, consts),
      })
      continue
    }
    if (hit.name === 'parallel') {
      const args = splitTopLevelArgs(hit.args)
      if (args.length >= 2) {
        const items = parsePythonListItems(args[0]!, lists)
        const cb = parseLambdaCallback(args[1]!, consts, defs)
        blocks.push({
          kind: 'parallel',
          phase: currentPhase,
          dynamic: true,
          agents: cb.agents,
          ...(items ? { items } : {}),
          ...(cb.params.length > 0 ? { mapParams: cb.params } : {}),
        })
      } else {
        const agents = findPythonAgentsInExpr(hit.args, consts)
        blocks.push({
          kind: 'parallel',
          phase: currentPhase,
          dynamic: agents.length === 0,
          agents,
        })
      }
      continue
    }
    if (hit.name === 'pipeline') {
      const args = splitTopLevelArgs(hit.args)
      const items = args[0] ? parsePythonListItems(args[0], lists) : undefined
      const stageExprs = args.slice(1)
      const agents: WorkflowAgentSpec[] = []
      const stageItemParams: Array<string | undefined> = []
      stageExprs.forEach((expr, idx) => {
        const cb = parseLambdaCallback(expr, consts, defs)
        agents.push(...cb.agents)
        stageItemParams.push(idx === 0 ? cb.params[0] : (cb.params[1] ?? cb.params[0]))
      })
      blocks.push({
        kind: 'pipeline',
        phase: currentPhase,
        dynamic: !items,
        stages: Math.max(1, stageExprs.length || agents.length || 1),
        agents,
        ...(items ? { items } : {}),
        ...(stageItemParams.length > 0 ? { stageItemParams } : {}),
      })
    }
  }

  return { phases, blocks }
}
