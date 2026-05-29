import { parse } from 'acorn'

export interface WorkflowAgentSpec {
  label?: string
  agentType?: string
  model?: string
}

export type WorkflowBlock =
  | { kind: 'agent'; phase?: string; agent: WorkflowAgentSpec }
  | { kind: 'parallel'; phase?: string; dynamic: boolean; agents: WorkflowAgentSpec[] }
  | { kind: 'pipeline'; phase?: string; dynamic: boolean; stages: number; agents: WorkflowAgentSpec[] }
  | { kind: 'workflow'; phase?: string; name?: string }

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

function getProp(obj: Node | undefined, name: string): Node | undefined {
  if (!obj || obj.type !== 'ObjectExpression') return undefined
  for (const p of obj.properties) {
    if (p.type !== 'Property') continue
    const key = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'Literal' ? p.key.value : undefined
    if (key === name) return p.value
  }
  return undefined
}

function agentSpec(call: Node, src: string): WorkflowAgentSpec {
  const opts = call.arguments[1]
  return {
    label: templateOrString(getProp(opts, 'label'), src),
    agentType: stringLiteral(getProp(opts, 'agentType')),
    model: stringLiteral(getProp(opts, 'model')),
  }
}

function findAgentSpecs(node: Node, src: string): WorkflowAgentSpec[] {
  const specs: WorkflowAgentSpec[] = []
  walk(node, (n) => {
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'agent') {
      specs.push(agentSpec(n, src))
    }
  })
  return specs
}

function unwrapCall(node: Node | undefined): Node | null {
  if (!node) return null
  if (node.type === 'AwaitExpression') return unwrapCall(node.argument)
  if (node.type === 'CallExpression') return node
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
      blocks.push({ kind: 'parallel', phase: currentPhase, dynamic: isMapCall(call.arguments[0]), agents: findAgentSpecs(call, wrapped) })
    } else if (name === 'pipeline') {
      blocks.push({
        kind: 'pipeline',
        phase: currentPhase,
        dynamic: call.arguments[0]?.type !== 'ArrayExpression',
        stages: Math.max(0, call.arguments.length - 1),
        agents: findAgentSpecs(call, wrapped),
      })
    } else if (name === 'agent') {
      blocks.push({ kind: 'agent', phase: currentPhase, agent: agentSpec(call, wrapped) })
    } else if (name === 'workflow') {
      blocks.push({ kind: 'workflow', phase: currentPhase, name: stringLiteral(call.arguments[0]) })
    }
  }
  return { phases, blocks }
}
