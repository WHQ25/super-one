import {
  clickScript,
  dragDispatchScript,
  hoverScript,
  inspectScript,
  pressScript,
  queryScript,
  resolvePointScript,
  scrollScript,
  selectScript,
  snapshotScript,
  typeScript,
  waitCheckScript,
} from './browser-automation-scripts'

export type PageScriptExecutor = (script: string) => Promise<unknown>

export interface PagePointTarget {
  selector?: string
  text?: string
  x?: number
  y?: number
}

export interface PageScriptInput extends PagePointTarget {
  include?: string[]
  filter?: string
  max?: number
  depth?: number
  treeMax?: number
  textMaxChars?: number
  expression?: string
  from?: PagePointTarget
  to?: PagePointTarget
  steps?: number
  holdMs?: number
  humanize?: boolean
  selectorGone?: string
  urlIncludes?: string
  timeoutMs?: number
  [key: string]: unknown
}

export const DEFAULT_SNAPSHOT_INCLUDE = ['meta', 'elements', 'console']

export const PAGE_SCRIPT_OPS = new Set(['query', 'inspect', 'click', 'hover', 'type', 'press', 'scroll', 'select', 'drag', 'wait_for'])

export function snapshotInclude(input: PageScriptInput): string[] {
  return input.include?.length ? input.include : DEFAULT_SNAPSHOT_INCLUDE
}

export async function snapshotPage(exec: PageScriptExecutor, input: PageScriptInput): Promise<Record<string, unknown>> {
  const include = snapshotInclude(input)
  const needsPage = include.some((s) => s === 'meta' || s === 'elements' || s === 'tree' || s === 'text')
  if (!needsPage) return {}
  return (await exec(snapshotScript({ include, filter: input.filter, max: input.max, depth: input.depth, treeMax: input.treeMax, textMaxChars: input.textMaxChars }))) as Record<string, unknown>
}

export function evaluateExpressionScript(expression: unknown): string {
  return `(async () => { return (${String(expression ?? '')}); })()`
}

export function assertEvaluateResultSize(value: unknown): void {
  if (JSON.stringify(value ?? null).length > 5_000_000) throw new Error('Evaluate result exceeds 5MB; narrow the expression')
}

async function waitForCondition(exec: PageScriptExecutor, input: PageScriptInput): Promise<unknown> {
  const timeoutMs = Math.min(input.timeoutMs ?? 15_000, 60_000)
  const start = Date.now()
  const deadline = start + timeoutMs
  const script = waitCheckScript(input)
  while (Date.now() <= deadline) {
    if ((await exec(script)) === true) return { ok: true, waitedMs: Date.now() - start }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`wait_for timed out after ${timeoutMs}ms`)
}

async function dragPage(exec: PageScriptExecutor, input: PageScriptInput): Promise<unknown> {
  const from = (await exec(resolvePointScript(input.from ?? {}))) as Record<string, unknown>
  if (from.ok === false) throw new Error(String(from.error ?? 'drag source not found'))
  const to = (await exec(resolvePointScript(input.to ?? {}))) as Record<string, unknown>
  if (to.ok === false) throw new Error(String(to.error ?? 'drag target not found'))
  await exec(dragDispatchScript(Number(from.x), Number(from.y), Number(to.x), Number(to.y), {
    steps: input.steps ?? 10,
    holdMs: input.holdMs ?? 0,
    humanize: input.humanize === true,
  }))
  return { ok: true, from: { selector: from.selector, name: from.name }, to: { selector: to.selector, name: to.name } }
}

export function resolvePagePoint(exec: PageScriptExecutor, input: PageScriptInput): Promise<Record<string, unknown>> {
  return exec(resolvePointScript(input)) as Promise<Record<string, unknown>>
}

export function runPageScriptOp(exec: PageScriptExecutor, op: string, input: PageScriptInput): Promise<unknown> {
  switch (op) {
    case 'query':
      return exec(queryScript(input as Parameters<typeof queryScript>[0]))
    case 'inspect':
      return exec(inspectScript(input as Parameters<typeof inspectScript>[0]))
    case 'click':
      return exec(clickScript(input))
    case 'hover':
      return exec(hoverScript(input))
    case 'type':
      return exec(typeScript(input as Parameters<typeof typeScript>[0]))
    case 'press':
      return exec(pressScript(input as Parameters<typeof pressScript>[0]))
    case 'scroll':
      return exec(scrollScript(input as Parameters<typeof scrollScript>[0]))
    case 'select':
      return exec(selectScript(input as Parameters<typeof selectScript>[0]))
    case 'drag':
      return dragPage(exec, input)
    case 'wait_for':
      return waitForCondition(exec, input)
    default:
      throw new Error(`Unknown browser automation op: ${op}`)
  }
}
