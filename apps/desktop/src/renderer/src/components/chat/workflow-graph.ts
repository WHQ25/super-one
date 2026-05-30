import { parse } from 'acorn'

export interface WorkflowAgentSpec {
  label?: string
  prompt?: string
  agentType?: string
  model?: string
}

export type FanoutItem = string | Record<string, string>

export type WorkflowBlock =
  | { kind: 'agent'; phase?: string; agent: WorkflowAgentSpec }
  | { kind: 'parallel'; phase?: string; dynamic: boolean; agents: WorkflowAgentSpec[]; items?: FanoutItem[]; mapParams?: string[] }
  | { kind: 'pipeline'; phase?: string; dynamic: boolean; stages: number; agents: WorkflowAgentSpec[]; items?: FanoutItem[]; stageItemParams?: (string | undefined)[] }
  | { kind: 'workflow'; phase?: string; name?: string; scriptPath?: string; child?: WorkflowGraph }

export interface WorkflowGraph {
  phases: string[]
  blocks: WorkflowBlock[]
}

type Node = Record<string, any>

function walk(node: Node | null | undefined, visit: (n: Node) => void): void {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key in node) {
    if (key === 'start' || key === 'end') continue
    const val = node[key]
    if (Array.isArray(val)) {
      for (const child of val) if (child && typeof child === 'object') walk(child as Node, visit)
    } else if (val && typeof val === 'object' && typeof val.type === 'string') {
      walk(val as Node, visit)
    }
  }
}

function stringLiteral(node: Node | undefined): string | undefined {
  return node && node.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined
}

function templateOrString(node: Node | undefined, src: string): string | undefined {
  if (!node) return undefined
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral') {
    let out = ''
    node.quasis.forEach((q: Node, i: number) => {
      out += q.value.cooked ?? q.value.raw ?? ''
      if (i < node.expressions.length) {
        const e = node.expressions[i]
        out += '${' + src.slice(e.start, e.end) + '}'
      }
    })
    return out
  }
  return undefined
}

function exprToTemplate(node: Node | undefined, src: string): string | undefined {
  const direct = templateOrString(node, src)
  if (direct !== undefined) return direct
  if (!node || typeof node.start !== 'number' || typeof node.end !== 'number') return undefined
  return '${' + src.slice(node.start, node.end) + '}'
}

function resolveConstsInTemplate(tpl: string | undefined, consts: Map<string, string>): string | undefined {
  if (tpl === undefined) return undefined
  return tpl.replace(/\$\{([^}]+)\}/g, (whole, expr) => {
    const val = consts.get(expr.trim())
    return val !== undefined ? val : whole
  })
}

function getProp(obj: Node | undefined, name: string): Node | undefined {
  if (!obj || obj.type !== 'ObjectExpression') return undefined
  for (const p of obj.properties) {
    if (p.type !== 'Property') continue
    const key = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'Literal' ? p.key.value : undefined
    if (key === name) return p.value
  }
  return undefined
}

function agentSpec(call: Node, src: string, consts: Map<string, string>): WorkflowAgentSpec {
  const opts = call.arguments[1]
  return {
    label: resolveConstsInTemplate(exprToTemplate(getProp(opts, 'label'), src), consts),
    prompt: resolveConstsInTemplate(exprToTemplate(call.arguments[0], src), consts),
    agentType: stringLiteral(getProp(opts, 'agentType')),
    model: stringLiteral(getProp(opts, 'model')),
  }
}

function findAgentSpecs(node: Node, src: string, consts: Map<string, string>): WorkflowAgentSpec[] {
  const specs: WorkflowAgentSpec[] = []
  walk(node, (n) => {
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'agent') {
      specs.push(agentSpec(n, src, consts))
    }
  })
  return specs
}

function unwrapCall(node: Node | undefined): Node | null {
  if (!node) return null
  if (node.type === 'AwaitExpression') return unwrapCall(node.argument)
  if (node.type === 'CallExpression') {
    if (node.callee.type === 'Identifier') return node
    if (node.callee.type === 'MemberExpression') return unwrapCall(node.callee.object)
  }
  return null
}

function statementCall(stmt: Node): Node | null {
  if (stmt.type === 'VariableDeclaration') return unwrapCall(stmt.declarations[0]?.init)
  if (stmt.type === 'ExpressionStatement') return unwrapCall(stmt.expression)
  if (stmt.type === 'ReturnStatement') return unwrapCall(stmt.argument)
  return null
}

function isMapCall(node: Node | undefined): boolean {
  return !!node && node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
    && node.callee.property.type === 'Identifier' && node.callee.property.name === 'map'
}

function collectStringConsts(stmts: Node[]): Map<string, string> {
  const consts = new Map<string, string>()
  const pending: { name: string; init: Node }[] = []
  for (const stmt of stmts) {
    if (stmt.type !== 'VariableDeclaration') continue
    for (const d of stmt.declarations) {
      if (d.id?.type !== 'Identifier' || !d.init) continue
      if (d.init.type === 'Literal' && typeof d.init.value === 'string') consts.set(d.id.name, d.init.value)
      else if (d.init.type === 'TemplateLiteral' || d.init.type === 'Identifier') pending.push({ name: d.id.name, init: d.init })
    }
  }
  for (let pass = 0; pass < 3 && pending.length > 0; pass++) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const v = resolveStringExpr(pending[i].init, consts)
      if (v !== undefined) { consts.set(pending[i].name, v); pending.splice(i, 1) }
    }
  }
  return consts
}

function resolveStringExpr(node: Node | undefined, consts: Map<string, string>): string | undefined {
  if (!node) return undefined
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'Identifier') return consts.get(node.name)
  if (node.type === 'TemplateLiteral') {
    let out = ''
    for (let i = 0; i < node.quasis.length; i++) {
      out += node.quasis[i].value.cooked ?? node.quasis[i].value.raw ?? ''
      if (i < node.expressions.length) {
        const v = resolveStringExpr(node.expressions[i], consts)
        if (v === undefined) return undefined
        out += v
      }
    }
    return out
  }
  return undefined
}

function deriveWorkflowName(scriptPath: string): string {
  const base = scriptPath.split('/').pop() ?? scriptPath
  return base.replace(/\.js$/, '').replace(/-wf_[a-z0-9-]+$/i, '')
}

function objectStringRecord(node: Node): Record<string, string> | undefined {
  const rec: Record<string, string> = {}
  for (const p of node.properties) {
    if (p.type !== 'Property') continue
    const key = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'Literal' ? String(p.key.value) : undefined
    if (key === undefined) continue
    if (p.value.type === 'Literal' && (typeof p.value.value === 'string' || typeof p.value.value === 'number' || typeof p.value.value === 'boolean')) {
      rec[key] = String(p.value.value)
    }
  }
  return rec
}

function arrayValues(node: Node): FanoutItem[] | undefined {
  const vals: FanoutItem[] = []
  for (const el of node.elements) {
    if (!el) return undefined
    if (el.type === 'Literal' && typeof el.value === 'string') vals.push(el.value)
    else if (el.type === 'ObjectExpression') {
      const rec = objectStringRecord(el)
      if (!rec) return undefined
      vals.push(rec)
    } else return undefined
  }
  return vals
}

function collectArrayConsts(stmts: Node[]): Map<string, FanoutItem[]> {
  const arrays = new Map<string, FanoutItem[]>()
  for (const stmt of stmts) {
    if (stmt.type !== 'VariableDeclaration') continue
    for (const d of stmt.declarations) {
      if (d.id?.type === 'Identifier' && d.init?.type === 'ArrayExpression') {
        const vals = arrayValues(d.init)
        if (vals) arrays.set(d.id.name, vals)
      }
    }
  }
  return arrays
}

function resolveArray(node: Node | undefined, arrays: Map<string, FanoutItem[]>): FanoutItem[] | undefined {
  if (!node) return undefined
  if (node.type === 'ArrayExpression') return arrayValues(node)
  if (node.type === 'Identifier') return arrays.get(node.name)
  return undefined
}

function mapFanout(mapCall: Node, arrays: Map<string, FanoutItem[]>): { items?: FanoutItem[]; mapParams?: string[] } {
  if (mapCall.type !== 'CallExpression' || mapCall.callee.type !== 'MemberExpression') return {}
  const items = resolveArray(mapCall.callee.object, arrays)
  const cb = mapCall.arguments[0]
  const mapParams = cb && (cb.type === 'ArrowFunctionExpression' || cb.type === 'FunctionExpression')
    ? cb.params.filter((p: Node) => p.type === 'Identifier').map((p: Node) => p.name as string)
    : undefined
  return { items, mapParams }
}

function stageItemParam(cb: Node | undefined, stageIndex: number): string | undefined {
  if (!cb || (cb.type !== 'ArrowFunctionExpression' && cb.type !== 'FunctionExpression')) return undefined
  const params = cb.params.filter((p: Node) => p.type === 'Identifier')
  const pos = stageIndex === 0 ? 0 : 1
  return params[pos]?.name
}

export function parseWorkflowGraph(script: string): WorkflowGraph {
  const phases: string[] = []
  const blocks: WorkflowBlock[] = []
  const wrapped = `async function __wf__(){\n${script.replace(/\bexport\s+const\b/g, 'const')}\n}`
  let stmts: Node[]
  try {
    const ast = parse(wrapped, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as Node
    stmts = (ast.body[0]?.body?.body ?? []) as Node[]
  } catch {
    return { phases, blocks }
  }

  const consts = collectStringConsts(stmts)
  const arrayConsts = collectArrayConsts(stmts)
  let currentPhase: string | undefined
  for (const stmt of stmts) {
    const call = statementCall(stmt)
    if (!call || call.callee.type !== 'Identifier') continue
    const name = call.callee.name
    if (name === 'phase') {
      const title = stringLiteral(call.arguments[0])
      if (title) {
        currentPhase = title
        if (!phases.includes(title)) phases.push(title)
      }
    } else if (name === 'parallel') {
      const arg0 = call.arguments[0]
      const dynamic = isMapCall(arg0)
      const fanout = dynamic && arg0 ? mapFanout(arg0, arrayConsts) : {}
      blocks.push({ kind: 'parallel', phase: currentPhase, dynamic, agents: findAgentSpecs(call, wrapped, consts), items: fanout.items, mapParams: fanout.mapParams })
    } else if (name === 'pipeline') {
      const stageCallbacks = call.arguments.slice(1)
      blocks.push({
        kind: 'pipeline',
        phase: currentPhase,
        dynamic: call.arguments[0]?.type !== 'ArrayExpression',
        stages: Math.max(0, call.arguments.length - 1),
        agents: findAgentSpecs(call, wrapped, consts),
        items: resolveArray(call.arguments[0], arrayConsts),
        stageItemParams: stageCallbacks.map((cb: Node, idx: number) => stageItemParam(cb, idx)),
      })
    } else if (name === 'agent') {
      blocks.push({ kind: 'agent', phase: currentPhase, agent: agentSpec(call, wrapped, consts) })
    } else if (name === 'workflow') {
      const arg0 = call.arguments[0]
      let scriptPath: string | undefined
      let wfName = stringLiteral(arg0)
      if (!wfName && arg0?.type === 'ObjectExpression') {
        scriptPath = resolveStringExpr(getProp(arg0, 'scriptPath'), consts)
        if (scriptPath) wfName = deriveWorkflowName(scriptPath)
      }
      blocks.push({ kind: 'workflow', phase: currentPhase, name: wfName, scriptPath })
    }
  }
  return { phases, blocks }
}

export function attachWorkflowChildren(
  graph: WorkflowGraph,
  scripts: Map<string, string>,
  seen: Set<string> = new Set(),
): WorkflowGraph {
  const blocks = graph.blocks.map((block) => {
    if (block.kind !== 'workflow' || !block.scriptPath || seen.has(block.scriptPath)) return block
    const src = scripts.get(block.scriptPath)
    if (!src) return block
    const childSeen = new Set(seen)
    childSeen.add(block.scriptPath)
    const child = attachWorkflowChildren(parseWorkflowGraph(src), scripts, childSeen)
    return { ...block, child }
  })
  return { ...graph, blocks }
}
