import { app } from 'electron'
import { dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { isDeepStrictEqual } from 'util'
import { z } from 'zod'
import { BROWSER_PRIMITIVE_TOOL_NAMES } from '../mcp/superone-mcp-builtin-defs'
import type { BrowserToolReply } from '../mcp/browser-mcp-replies'

const ACTION_STORE_VERSION = 1 as const
const ACTION_FILE = 'browser-actions.json'
const ACTION_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/
const INPUT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/
const FLOW_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/
const FLOW_REFERENCE_PATTERN = /^(?:input|vars|result|item|index)(?:\.[A-Za-z0-9_-]+)*$/
const FLOW_TEMPLATE_PATTERN = /\$\{((?:input|vars|result|item|index)(?:\.[A-Za-z0-9_-]+)*)\}/g
const FLOW_EXACT_TEMPLATE_PATTERN = /^\$\{((?:input|vars|result|item|index)(?:\.[A-Za-z0-9_-]+)*)\}$/

export const MAX_BROWSER_ACTION_DEPTH = 8
export const MAX_BROWSER_ACTION_STEPS = 100
export const MAX_BROWSER_ACTION_STEPS_PER_ACTION = 50
export const MAX_BROWSER_ACTION_FLOW_DEPTH = 8
export const MAX_BROWSER_ACTION_LOOP_ITERATIONS = 50

const primitiveToolNameSchema = z.enum(BROWSER_PRIMITIVE_TOOL_NAMES)
const flowNameSchema = z.string().regex(FLOW_NAME_PATTERN, 'Variable names must start with a letter or underscore and contain only letters, numbers, underscores, or hyphens.')

export const browserActionParameterSchema = z.object({
  name: z.string().regex(INPUT_NAME_PATTERN, 'Input names must start with a letter or underscore and contain only letters, numbers, underscores, or hyphens.').describe('Input name referenced in step templates as ${input.name}.'),
  description: z.string().min(1).max(500).optional().describe('What the caller should provide.'),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']).optional().describe('Optional runtime type constraint.'),
  required: z.boolean().default(true),
  default: z.unknown().optional(),
}).strict()

const browserActionOperatorSchema = z.enum([
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'and',
  'or',
  'not',
  'exists',
  'contains',
  'add',
  'subtract',
  'multiply',
  'divide',
])

type BrowserActionOperator = z.infer<typeof browserActionOperatorSchema>

export type BrowserActionExpression =
  | string
  | number
  | boolean
  | null
  | { kind: 'literal'; value: unknown }
  | { kind: 'ref'; path: string }
  | { kind: 'op'; op: BrowserActionOperator; args: BrowserActionExpression[] }

const OPERATOR_ARITY: Record<BrowserActionOperator, number | { min: number }> = {
  eq: 2,
  ne: 2,
  gt: 2,
  gte: 2,
  lt: 2,
  lte: 2,
  and: { min: 2 },
  or: { min: 2 },
  not: 1,
  exists: 1,
  contains: 2,
  add: 2,
  subtract: 2,
  multiply: 2,
  divide: 2,
}

export const browserActionExpressionSchema: z.ZodType<BrowserActionExpression> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({ kind: z.literal('literal'), value: z.unknown() }).strict(),
  z.object({
    kind: z.literal('ref'),
    path: z.string().regex(FLOW_REFERENCE_PATTERN, 'References must start with input, vars, result, item, or index.'),
  }).strict(),
  z.object({
    kind: z.literal('op'),
    op: browserActionOperatorSchema,
    args: z.array(browserActionExpressionSchema).min(1).max(20),
  }).strict().superRefine((expression, ctx) => {
    const arity = OPERATOR_ARITY[expression.op]
    if (typeof arity === 'number' && expression.args.length !== arity) {
      ctx.addIssue({ code: 'custom', path: ['args'], message: `Operator '${expression.op}' expects ${arity} argument${arity === 1 ? '' : 's'}.` })
    } else if (typeof arity !== 'number' && expression.args.length < arity.min) {
      ctx.addIssue({ code: 'custom', path: ['args'], message: `Operator '${expression.op}' expects at least ${arity.min} arguments.` })
    }
  }),
])).describe('A literal JSON scalar, {kind:"literal",value:any JSON}, {kind:"ref",path:"input|vars|result|item|index..."}, or {kind:"op",op,args}. Operators: eq, ne, gt, gte, lt, lte, and, or, not, exists, contains, add, subtract, multiply, divide.')

type BrowserPrimitiveToolName = z.infer<typeof primitiveToolNameSchema>

interface BrowserPrimitiveStep {
  kind: 'tool'
  tool: BrowserPrimitiveToolName
  args: Record<string, unknown>
  saveAs?: string
}

interface BrowserNestedActionStep {
  kind: 'action'
  domain: string
  name: string
  input: Record<string, unknown>
  saveAs?: string
}

interface BrowserSetStep {
  kind: 'set'
  name: string
  value: BrowserActionExpression
}

interface BrowserIfStep {
  kind: 'if'
  condition: BrowserActionExpression
  then: BrowserActionStep[]
  else?: BrowserActionStep[]
}

interface BrowserForEachStep {
  kind: 'forEach'
  items: BrowserActionExpression
  steps: BrowserActionStep[]
}

interface BrowserRepeatStep {
  kind: 'repeat'
  times: BrowserActionExpression
  steps: BrowserActionStep[]
}

export type BrowserActionStep =
  | BrowserPrimitiveStep
  | BrowserNestedActionStep
  | BrowserSetStep
  | BrowserIfStep
  | BrowserForEachStep
  | BrowserRepeatStep

const browserPrimitiveStepSchema = z.object({
  kind: z.literal('tool'),
  tool: primitiveToolNameSchema,
  args: z.record(z.string(), z.unknown()).default({}),
  saveAs: flowNameSchema.optional().describe('Save the primitive tool result into vars under this name.'),
}).strict()

const browserNestedActionStepSchema = z.object({
  kind: z.literal('action'),
  domain: z.string().min(1).max(500),
  name: z.string().regex(ACTION_NAME_PATTERN),
  input: z.record(z.string(), z.unknown()).default({}),
  saveAs: flowNameSchema.optional().describe('Save the nested action last result into vars under this name.'),
}).strict()

export const browserActionStepSchema: z.ZodType<BrowserActionStep> = z.lazy(() => z.discriminatedUnion('kind', [
  browserPrimitiveStepSchema,
  browserNestedActionStepSchema,
  z.object({
    kind: z.literal('set'),
    name: flowNameSchema,
    value: browserActionExpressionSchema,
  }).strict(),
  z.object({
    kind: z.literal('if'),
    condition: browserActionExpressionSchema,
    then: z.array(browserActionStepSchema).min(1),
    else: z.array(browserActionStepSchema).min(1).optional(),
  }).strict(),
  z.object({
    kind: z.literal('forEach'),
    items: browserActionExpressionSchema,
    steps: z.array(browserActionStepSchema).min(1),
  }).strict(),
  z.object({
    kind: z.literal('repeat'),
    times: browserActionExpressionSchema,
    steps: z.array(browserActionStepSchema).min(1),
  }).strict(),
])).describe('A sequential tool, nested action, set, if, forEach, or repeat step. Control-flow child steps execute in order and count toward execution limits.')

export const browserActionSchema = z.object({
  domain: z.string().min(1).max(500).describe('Semantic domain namespace, normally a hostname such as github.com.'),
  name: z.string().regex(ACTION_NAME_PATTERN, 'Action names must start with a lowercase letter and contain only lowercase letters, numbers, underscores, or hyphens.'),
  description: z.string().min(1).max(1000),
  parameters: z.array(browserActionParameterSchema).max(50).default([]),
  steps: z.array(browserActionStepSchema).min(1).max(MAX_BROWSER_ACTION_STEPS_PER_ACTION),
}).strict()

const browserActionStoreSchema = z.object({
  version: z.literal(ACTION_STORE_VERSION),
  actions: z.array(browserActionSchema),
}).strict()

export type BrowserAction = z.infer<typeof browserActionSchema>
export type BrowserActionParameter = z.infer<typeof browserActionParameterSchema>

export interface BrowserActionSummary {
  domain: string
  name: string
  description: string
  parameters: BrowserActionParameter[]
  stepCount: number
}

export interface BrowserActionExecutionSuccess {
  ok: true
  action: string
  stepsExecuted: number
  lastResult?: unknown
}

export interface BrowserActionExecutionFailure {
  ok: false
  action: string
  stepsExecuted: number
  error: string
  callStack: string[]
  failedStep?: {
    action: string
    index: number
    target: string
  }
}

export type BrowserActionExecutionResult = BrowserActionExecutionSuccess | BrowserActionExecutionFailure

interface BrowserActionExecutionOptions {
  domain: string
  name: string
  input?: Record<string, unknown>
  tab?: string
  executeTool: (tool: string, args: Record<string, unknown>) => Promise<BrowserToolReply>
}

interface ExecutionState {
  stepsExecuted: number
  stack: string[]
  actions: Map<string, BrowserAction>
  vars: Record<string, unknown>
  loopScopes: Array<{ index: number; item?: unknown; hasItem: boolean }>
  resultVersion: number
  tab?: string
  lastResult?: unknown
  executeTool: BrowserActionExecutionOptions['executeTool']
}

const TAB_SCOPED_TOOLS = new Set<string>([
  'browser_snapshot',
  'browser_query',
  'browser_inspect',
  'browser_screenshot',
  'browser_click',
  'browser_hover',
  'browser_type',
  'browser_navigate',
  'browser_wait_for',
  'browser_press',
  'browser_scroll',
  'browser_drag',
  'browser_select',
  'browser_evaluate',
  'browser_resize',
  'browser_network_start',
  'browser_cookies',
  'browser_upload_file',
  'browser_emulate',
  'browser_mock',
])

export function normalizeBrowserActionDomain(value: string): string {
  const raw = value.trim().toLowerCase()
  if (!raw) throw new Error('Action domain cannot be empty.')
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    if (!url.hostname) throw new Error('missing hostname')
    return url.hostname.replace(/\.$/, '')
  } catch {
    throw new Error(`Invalid action domain: ${value}`)
  }
}

function actionKey(domain: string, name: string): string {
  return `${normalizeBrowserActionDomain(domain)}/${name}`
}

function sortActions(actions: BrowserAction[]): BrowserAction[] {
  return [...actions].sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name))
}

function normalizeActionSteps(steps: BrowserActionStep[]): BrowserActionStep[] {
  return steps.map((step) => {
    if (step.kind === 'action') return { ...step, domain: normalizeBrowserActionDomain(step.domain) }
    if (step.kind === 'if') {
      return {
        ...step,
        then: normalizeActionSteps(step.then),
        ...(step.else ? { else: normalizeActionSteps(step.else) } : {}),
      }
    }
    if (step.kind === 'forEach' || step.kind === 'repeat') {
      return { ...step, steps: normalizeActionSteps(step.steps) }
    }
    return step
  })
}

function validateActionStepStructure(steps: BrowserActionStep[], depth = 0): number {
  if (depth > MAX_BROWSER_ACTION_FLOW_DEPTH) {
    throw new Error(`Browser action flow nesting exceeds the maximum depth of ${MAX_BROWSER_ACTION_FLOW_DEPTH}.`)
  }
  let count = 0
  for (const step of steps) {
    count += 1
    if (step.kind === 'if') {
      count += validateActionStepStructure(step.then, depth + 1)
      if (step.else) count += validateActionStepStructure(step.else, depth + 1)
    } else if (step.kind === 'forEach' || step.kind === 'repeat') {
      count += validateActionStepStructure(step.steps, depth + 1)
    }
    if (count > MAX_BROWSER_ACTION_STEPS_PER_ACTION) {
      throw new Error(`Browser action definitions may contain at most ${MAX_BROWSER_ACTION_STEPS_PER_ACTION} steps.`)
    }
  }
  return count
}

function normalizeAction(input: unknown): BrowserAction {
  const parsed = browserActionSchema.parse(input)
  const parameterNames = new Set<string>()
  for (const parameter of parsed.parameters) {
    if (parameterNames.has(parameter.name)) throw new Error(`Duplicate action parameter: ${parameter.name}`)
    parameterNames.add(parameter.name)
    if (Object.hasOwn(parameter, 'default')) assertParameterType(parameter, parameter.default)
  }
  validateActionStepStructure(parsed.steps)
  return {
    ...parsed,
    domain: normalizeBrowserActionDomain(parsed.domain),
    steps: normalizeActionSteps(parsed.steps),
  }
}

function getStorePath(): string {
  return join(app.getPath('userData'), ACTION_FILE)
}

function readStore(): { version: typeof ACTION_STORE_VERSION; actions: BrowserAction[] } {
  const path = getStorePath()
  if (!existsSync(path)) return { version: ACTION_STORE_VERSION, actions: [] }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`Cannot read browser actions from ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  const parsed = browserActionStoreSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`Invalid browser action store at ${path}: ${z.prettifyError(parsed.error)}`)
  return { version: ACTION_STORE_VERSION, actions: sortActions(parsed.data.actions.map(normalizeAction)) }
}

function writeStore(actions: BrowserAction[]): void {
  const path = getStorePath()
  const tempPath = `${path}.${process.pid}.tmp`
  mkdirSync(dirname(path), { recursive: true })
  try {
    writeFileSync(tempPath, `${JSON.stringify({ version: ACTION_STORE_VERSION, actions: sortActions(actions) }, null, 2)}\n`, 'utf8')
    renameSync(tempPath, path)
  } catch (err) {
    rmSync(tempPath, { force: true })
    throw err
  }
}

function assertNoKnownCycles(actions: BrowserAction[]): void {
  const byKey = new Map(actions.map((action) => [actionKey(action.domain, action.name), action]))
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (key: string, path: string[]): void => {
    if (visiting.has(key)) throw new Error(`Browser action cycle detected: ${[...path, key].join(' -> ')}`)
    if (visited.has(key)) return
    const action = byKey.get(key)
    if (!action) return
    visiting.add(key)
    const visitSteps = (steps: BrowserActionStep[]): void => {
      for (const step of steps) {
        if (step.kind === 'action') visit(actionKey(step.domain, step.name), [...path, key])
        else if (step.kind === 'if') {
          visitSteps(step.then)
          if (step.else) visitSteps(step.else)
        } else if (step.kind === 'forEach' || step.kind === 'repeat') {
          visitSteps(step.steps)
        }
      }
    }
    visitSteps(action.steps)
    visiting.delete(key)
    visited.add(key)
  }

  for (const key of byKey.keys()) visit(key, [])
}

export function saveBrowserAction(input: unknown): { action: BrowserAction; created: boolean } {
  const action = normalizeAction(input)
  const store = readStore()
  const key = actionKey(action.domain, action.name)
  const index = store.actions.findIndex((candidate) => actionKey(candidate.domain, candidate.name) === key)
  const created = index < 0
  if (created) store.actions.push(action)
  else store.actions[index] = action
  assertNoKnownCycles(store.actions)
  writeStore(store.actions)
  return { action, created }
}

export function listBrowserActions(domain?: string): BrowserAction[] {
  const actions = readStore().actions
  if (domain == null) return actions
  const normalized = normalizeBrowserActionDomain(domain)
  return actions.filter((action) => action.domain === normalized)
}

export function summarizeBrowserAction(action: BrowserAction): BrowserActionSummary {
  return {
    domain: action.domain,
    name: action.name,
    description: action.description,
    parameters: action.parameters,
    stepCount: validateActionStepStructure(action.steps),
  }
}

function assertParameterType(parameter: BrowserActionParameter, value: unknown): void {
  if (!parameter.type) return
  const valid = parameter.type === 'array'
    ? Array.isArray(value)
    : parameter.type === 'object'
      ? value !== null && typeof value === 'object' && !Array.isArray(value)
      : typeof value === parameter.type
  if (!valid) throw new Error(`Input '${parameter.name}' must be ${parameter.type}.`)
}

function resolveActionInput(action: BrowserAction, supplied: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set(action.parameters.map((parameter) => parameter.name))
  const unknown = Object.keys(supplied).filter((name) => !allowed.has(name))
  if (unknown.length > 0) throw new Error(`Unknown input for ${actionKey(action.domain, action.name)}: ${unknown.join(', ')}`)

  const resolved: Record<string, unknown> = {}
  for (const parameter of action.parameters) {
    const suppliedValue = supplied[parameter.name]
    const hasSuppliedValue = Object.hasOwn(supplied, parameter.name)
    if (hasSuppliedValue) resolved[parameter.name] = suppliedValue
    else if (Object.hasOwn(parameter, 'default')) resolved[parameter.name] = parameter.default
    else if (parameter.required) throw new Error(`Missing required input '${parameter.name}' for ${actionKey(action.domain, action.name)}.`)
    if (Object.hasOwn(resolved, parameter.name)) assertParameterType(parameter, resolved[parameter.name])
  }
  return resolved
}

interface BrowserActionValueContext {
  input: Record<string, unknown>
  vars: Record<string, unknown>
  hasResult: boolean
  result?: unknown
  loop?: { index: number; item?: unknown; hasItem: boolean }
}

class MissingBrowserActionValueError extends Error {}

function lookupBrowserActionValue(context: BrowserActionValueContext, path: string): unknown {
  const [root, ...segments] = path.split('.')
  let value: unknown
  let available = true
  if (root === 'input') value = context.input
  else if (root === 'vars') value = context.vars
  else if (root === 'result') {
    available = context.hasResult
    value = context.result
  } else if (root === 'item') {
    available = context.loop?.hasItem === true
    value = context.loop?.item
  } else if (root === 'index') {
    available = context.loop != null
    value = context.loop?.index
  } else {
    available = false
  }

  if (!available) throw new MissingBrowserActionValueError(`Browser action value is missing: ${path}`)
  for (const segment of segments) {
    if (value == null || typeof value !== 'object' || !Object.hasOwn(value, segment)) {
      if (root === 'input') throw new MissingBrowserActionValueError(`Template references missing input: ${segments.join('.')}`)
      throw new MissingBrowserActionValueError(`Browser action value is missing: ${path}`)
    }
    value = (value as Record<string, unknown>)[segment]
  }
  return value
}

function interpolateString(value: string, context: BrowserActionValueContext): unknown {
  const exact = value.match(FLOW_EXACT_TEMPLATE_PATTERN)
  if (exact) return lookupBrowserActionValue(context, exact[1])
  return value.replace(FLOW_TEMPLATE_PATTERN, (_match, path: string) => {
    const replacement = lookupBrowserActionValue(context, path)
    if (typeof replacement === 'string') return replacement
    return JSON.stringify(replacement) ?? 'undefined'
  })
}

function resolveBrowserActionTemplatesWithContext(value: unknown, context: BrowserActionValueContext): unknown {
  if (typeof value === 'string') return interpolateString(value, context)
  if (Array.isArray(value)) return value.map((item) => resolveBrowserActionTemplatesWithContext(item, context))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveBrowserActionTemplatesWithContext(item, context)]))
  }
  return value
}

export function resolveBrowserActionTemplates(value: unknown, input: Record<string, unknown>): unknown {
  return resolveBrowserActionTemplatesWithContext(value, {
    input,
    vars: Object.create(null) as Record<string, unknown>,
    hasResult: false,
  })
}

function assertBooleanOperatorValue(operator: BrowserActionOperator, value: unknown): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error(`Operator '${operator}' expects boolean arguments.`)
}

function assertNumericOperatorValues(operator: BrowserActionOperator, values: unknown[]): asserts values is number[] {
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`Operator '${operator}' expects finite number arguments.`)
  }
}

function evaluateBrowserActionExpression(expression: BrowserActionExpression, context: BrowserActionValueContext): unknown {
  if (expression == null || typeof expression !== 'object') return expression
  if (expression.kind === 'literal') return expression.value
  if (expression.kind === 'ref') return lookupBrowserActionValue(context, expression.path)

  if (expression.op === 'exists') {
    try {
      evaluateBrowserActionExpression(expression.args[0], context)
      return true
    } catch (err) {
      if (err instanceof MissingBrowserActionValueError) return false
      throw err
    }
  }
  if (expression.op === 'and') {
    for (const argument of expression.args) {
      const value = evaluateBrowserActionExpression(argument, context)
      assertBooleanOperatorValue(expression.op, value)
      if (!value) return false
    }
    return true
  }
  if (expression.op === 'or') {
    for (const argument of expression.args) {
      const value = evaluateBrowserActionExpression(argument, context)
      assertBooleanOperatorValue(expression.op, value)
      if (value) return true
    }
    return false
  }

  const values = expression.args.map((argument) => evaluateBrowserActionExpression(argument, context))
  switch (expression.op) {
    case 'eq': return isDeepStrictEqual(values[0], values[1])
    case 'ne': return !isDeepStrictEqual(values[0], values[1])
    case 'not':
      assertBooleanOperatorValue(expression.op, values[0])
      return !values[0]
    case 'contains': {
      const [container, target] = values
      if (typeof container === 'string' && typeof target === 'string') return container.includes(target)
      if (Array.isArray(container)) return container.some((value) => isDeepStrictEqual(value, target))
      if (container != null && typeof container === 'object' && typeof target === 'string') return Object.hasOwn(container, target)
      throw new Error("Operator 'contains' expects a string, array, or object as its first argument.")
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide': {
      assertNumericOperatorValues(expression.op, values)
      const [left, right] = values
      if (expression.op === 'gt') return left > right
      if (expression.op === 'gte') return left >= right
      if (expression.op === 'lt') return left < right
      if (expression.op === 'lte') return left <= right
      if (expression.op === 'add') return left + right
      if (expression.op === 'subtract') return left - right
      if (expression.op === 'multiply') return left * right
      if (right === 0) throw new Error("Operator 'divide' cannot divide by zero.")
      return left / right
    }
  }
}

function replyResult(reply: BrowserToolReply): unknown {
  const values = reply.content.map((content) => {
    if (content.type === 'image') return { type: 'image', mimeType: content.mimeType }
    try {
      return JSON.parse(content.text)
    } catch {
      return content.text
    }
  })
  return values.length === 1 ? values[0] : values
}

function replyError(reply: BrowserToolReply): string {
  return reply.content
    .map((content) => content.type === 'text' ? content.text.replace(/^\[Error\]\s*/, '') : 'Browser tool returned an image error.')
    .join('\n')
}

function resultError(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined
  const record = result as Record<string, unknown>
  if (record.ok !== false) return undefined
  return typeof record.error === 'string' ? record.error : 'Browser tool returned ok:false.'
}

function executionContext(input: Record<string, unknown>, state: ExecutionState): BrowserActionValueContext {
  const currentLoop = state.loopScopes.at(-1)
  let itemLoop: ExecutionState['loopScopes'][number] | undefined
  for (let index = state.loopScopes.length - 1; index >= 0; index -= 1) {
    if (state.loopScopes[index].hasItem) {
      itemLoop = state.loopScopes[index]
      break
    }
  }
  return {
    input,
    vars: state.vars,
    hasResult: state.resultVersion > 0,
    result: state.lastResult,
    loop: currentLoop && {
      index: currentLoop.index,
      item: itemLoop?.item,
      hasItem: itemLoop != null,
    },
  }
}

function stepTarget(step: BrowserActionStep): string {
  if (step.kind === 'tool') return step.tool
  if (step.kind === 'action') return actionKey(step.domain, step.name)
  if (step.kind === 'set') return `set:${step.name}`
  return step.kind
}

function stepFailure(
  key: string,
  index: number,
  step: BrowserActionStep,
  state: ExecutionState,
  error: unknown,
): BrowserActionExecutionFailure {
  return {
    ok: false,
    action: state.stack[0] ?? key,
    stepsExecuted: state.stepsExecuted,
    error: error instanceof Error ? error.message : String(error),
    callStack: [...state.stack],
    failedStep: { action: key, index, target: stepTarget(step) },
  }
}

async function runSteps(
  key: string,
  steps: BrowserActionStep[],
  input: Record<string, unknown>,
  state: ExecutionState,
): Promise<BrowserActionExecutionFailure | undefined> {
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    if (state.stepsExecuted >= MAX_BROWSER_ACTION_STEPS) {
      return stepFailure(
        key,
        index,
        step,
        state,
        `Browser action execution exceeds the maximum of ${MAX_BROWSER_ACTION_STEPS} steps.`,
      )
    }
    state.stepsExecuted += 1

    try {
      const context = executionContext(input, state)
      if (step.kind === 'action') {
        const nestedInput = resolveBrowserActionTemplatesWithContext(step.input, context) as Record<string, unknown>
        const resultVersion = state.resultVersion
        const failure = await runAction(step.domain, step.name, nestedInput, state)
        if (failure) return failure
        if (step.saveAs) {
          if (state.resultVersion === resultVersion) {
            throw new Error(`Nested browser action ${actionKey(step.domain, step.name)} did not produce a result for saveAs.`)
          }
          state.vars[step.saveAs] = state.lastResult
        }
      } else if (step.kind === 'tool') {
        const args = resolveBrowserActionTemplatesWithContext(step.args, context) as Record<string, unknown>
        if (state.tab && TAB_SCOPED_TOOLS.has(step.tool) && args.tab == null) args.tab = state.tab
        const reply = await state.executeTool(step.tool, args)
        const result = replyResult(reply)
        const error = reply.isError ? replyError(reply) : resultError(result)
        if (error) return stepFailure(key, index, step, state, error)
        state.lastResult = result
        state.resultVersion += 1
        if (step.saveAs) state.vars[step.saveAs] = result
      } else if (step.kind === 'set') {
        state.vars[step.name] = evaluateBrowserActionExpression(step.value, context)
      } else if (step.kind === 'if') {
        const condition = evaluateBrowserActionExpression(step.condition, context)
        if (typeof condition !== 'boolean') throw new Error("Browser action 'if' condition must evaluate to a boolean.")
        const branch = condition ? step.then : step.else
        if (branch) {
          const failure = await runSteps(key, branch, input, state)
          if (failure) return failure
        }
      } else if (step.kind === 'forEach') {
        const items = evaluateBrowserActionExpression(step.items, context)
        if (!Array.isArray(items)) throw new Error("Browser action 'forEach' items must evaluate to an array.")
        if (items.length > MAX_BROWSER_ACTION_LOOP_ITERATIONS) {
          throw new Error(`Browser action loop exceeds the maximum of ${MAX_BROWSER_ACTION_LOOP_ITERATIONS} iterations.`)
        }
        for (let loopIndex = 0; loopIndex < items.length; loopIndex += 1) {
          state.loopScopes.push({ item: items[loopIndex], index: loopIndex, hasItem: true })
          try {
            const failure = await runSteps(key, step.steps, input, state)
            if (failure) return failure
          } finally {
            state.loopScopes.pop()
          }
        }
      } else {
        const times = evaluateBrowserActionExpression(step.times, context)
        if (typeof times !== 'number' || !Number.isInteger(times) || times < 0) {
          throw new Error("Browser action 'repeat' times must evaluate to a non-negative integer.")
        }
        if (times > MAX_BROWSER_ACTION_LOOP_ITERATIONS) {
          throw new Error(`Browser action loop exceeds the maximum of ${MAX_BROWSER_ACTION_LOOP_ITERATIONS} iterations.`)
        }
        for (let loopIndex = 0; loopIndex < times; loopIndex += 1) {
          state.loopScopes.push({ index: loopIndex, hasItem: false })
          try {
            const failure = await runSteps(key, step.steps, input, state)
            if (failure) return failure
          } finally {
            state.loopScopes.pop()
          }
        }
      }
    } catch (err) {
      return stepFailure(key, index, step, state, err)
    }
  }
}

async function runAction(
  domain: string,
  name: string,
  suppliedInput: Record<string, unknown>,
  state: ExecutionState,
): Promise<BrowserActionExecutionFailure | undefined> {
  const key = actionKey(domain, name)
  if (state.stack.includes(key)) {
    return { ok: false, action: state.stack[0] ?? key, stepsExecuted: state.stepsExecuted, error: `Browser action cycle detected: ${[...state.stack, key].join(' -> ')}`, callStack: [...state.stack, key] }
  }
  if (state.stack.length >= MAX_BROWSER_ACTION_DEPTH) {
    return { ok: false, action: state.stack[0] ?? key, stepsExecuted: state.stepsExecuted, error: `Browser action nesting exceeds the maximum depth of ${MAX_BROWSER_ACTION_DEPTH}.`, callStack: [...state.stack, key] }
  }

  const action = state.actions.get(key)
  if (!action) {
    return { ok: false, action: state.stack[0] ?? key, stepsExecuted: state.stepsExecuted, error: `Browser action not found: ${key}`, callStack: [...state.stack, key] }
  }

  let input: Record<string, unknown>
  try {
    input = resolveActionInput(action, suppliedInput)
  } catch (err) {
    return { ok: false, action: state.stack[0] ?? key, stepsExecuted: state.stepsExecuted, error: err instanceof Error ? err.message : String(err), callStack: [...state.stack, key] }
  }

  state.stack.push(key)
  try {
    return await runSteps(key, action.steps, input, state)
  } finally {
    state.stack.pop()
  }
}

export async function executeBrowserAction(options: BrowserActionExecutionOptions): Promise<BrowserActionExecutionResult> {
  const rootKey = actionKey(options.domain, options.name)
  const actions = readStore().actions
  const state: ExecutionState = {
    stepsExecuted: 0,
    stack: [],
    actions: new Map(actions.map((action) => [actionKey(action.domain, action.name), action])),
    vars: Object.create(null) as Record<string, unknown>,
    loopScopes: [],
    resultVersion: 0,
    tab: options.tab,
    executeTool: options.executeTool,
  }
  const failure = await runAction(options.domain, options.name, options.input ?? {}, state)
  if (failure) return failure
  return {
    ok: true,
    action: rootKey,
    stepsExecuted: state.stepsExecuted,
    ...(state.resultVersion === 0 ? {} : { lastResult: state.lastResult }),
  }
}
