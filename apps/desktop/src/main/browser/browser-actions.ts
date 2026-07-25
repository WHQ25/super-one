import { app } from 'electron'
import { dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { z } from 'zod'
import { BROWSER_PRIMITIVE_TOOL_NAMES } from '../mcp/superone-mcp-builtin-defs'
import type { BrowserToolReply } from '../mcp/browser-mcp-replies'

const ACTION_STORE_VERSION = 1 as const
const ACTION_FILE = 'browser-actions.json'
const ACTION_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/
const INPUT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/
const TEMPLATE_PATTERN = /\$\{input\.([A-Za-z_][A-Za-z0-9_.-]*)\}/g

export const MAX_BROWSER_ACTION_DEPTH = 8
export const MAX_BROWSER_ACTION_STEPS = 100
export const MAX_BROWSER_ACTION_STEPS_PER_ACTION = 50

const primitiveToolNameSchema = z.enum(BROWSER_PRIMITIVE_TOOL_NAMES)

export const browserActionParameterSchema = z.object({
  name: z.string().regex(INPUT_NAME_PATTERN, 'Input names must start with a letter or underscore and contain only letters, numbers, underscores, or hyphens.').describe('Input name referenced in step templates as ${input.name}.'),
  description: z.string().min(1).max(500).optional().describe('What the caller should provide.'),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']).optional().describe('Optional runtime type constraint.'),
  required: z.boolean().default(true),
  default: z.unknown().optional(),
}).strict()

const browserPrimitiveStepSchema = z.object({
  kind: z.literal('tool'),
  tool: primitiveToolNameSchema,
  args: z.record(z.string(), z.unknown()).default({}),
}).strict()

const browserNestedActionStepSchema = z.object({
  kind: z.literal('action'),
  domain: z.string().min(1).max(500),
  name: z.string().regex(ACTION_NAME_PATTERN),
  input: z.record(z.string(), z.unknown()).default({}),
}).strict()

export const browserActionStepSchema = z.discriminatedUnion('kind', [
  browserPrimitiveStepSchema,
  browserNestedActionStepSchema,
])

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
export type BrowserActionStep = z.infer<typeof browserActionStepSchema>
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

function normalizeAction(input: unknown): BrowserAction {
  const parsed = browserActionSchema.parse(input)
  const parameterNames = new Set<string>()
  for (const parameter of parsed.parameters) {
    if (parameterNames.has(parameter.name)) throw new Error(`Duplicate action parameter: ${parameter.name}`)
    parameterNames.add(parameter.name)
    if (Object.hasOwn(parameter, 'default')) assertParameterType(parameter, parameter.default)
  }
  return {
    ...parsed,
    domain: normalizeBrowserActionDomain(parsed.domain),
    steps: parsed.steps.map((step) => step.kind === 'action'
      ? { ...step, domain: normalizeBrowserActionDomain(step.domain) }
      : step),
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
    for (const step of action.steps) {
      if (step.kind === 'action') visit(actionKey(step.domain, step.name), [...path, key])
    }
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
    stepCount: action.steps.length,
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

function lookupTemplateValue(input: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.')
  let value: unknown = input
  for (const segment of segments) {
    if (value == null || typeof value !== 'object' || !Object.hasOwn(value, segment)) {
      throw new Error(`Template references missing input: ${path}`)
    }
    value = (value as Record<string, unknown>)[segment]
  }
  return value
}

function interpolateString(value: string, input: Record<string, unknown>): unknown {
  const exact = value.match(/^\$\{input\.([A-Za-z_][A-Za-z0-9_.-]*)\}$/)
  if (exact) return lookupTemplateValue(input, exact[1])
  return value.replace(TEMPLATE_PATTERN, (_match, path: string) => {
    const replacement = lookupTemplateValue(input, path)
    return typeof replacement === 'string' ? replacement : JSON.stringify(replacement)
  })
}

export function resolveBrowserActionTemplates(value: unknown, input: Record<string, unknown>): unknown {
  if (typeof value === 'string') return interpolateString(value, input)
  if (Array.isArray(value)) return value.map((item) => resolveBrowserActionTemplates(item, input))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveBrowserActionTemplates(item, input)]))
  }
  return value
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
    for (let index = 0; index < action.steps.length; index += 1) {
      const step = action.steps[index]
      if (state.stepsExecuted >= MAX_BROWSER_ACTION_STEPS) {
        return {
          ok: false,
          action: state.stack[0],
          stepsExecuted: state.stepsExecuted,
          error: `Browser action execution exceeds the maximum of ${MAX_BROWSER_ACTION_STEPS} steps.`,
          callStack: [...state.stack],
          failedStep: { action: key, index, target: step.kind === 'tool' ? step.tool : actionKey(step.domain, step.name) },
        }
      }
      state.stepsExecuted += 1

      try {
        if (step.kind === 'action') {
          const nestedInput = resolveBrowserActionTemplates(step.input, input) as Record<string, unknown>
          const failure = await runAction(step.domain, step.name, nestedInput, state)
          if (failure) return failure
          continue
        }

        const args = resolveBrowserActionTemplates(step.args, input) as Record<string, unknown>
        if (state.tab && TAB_SCOPED_TOOLS.has(step.tool) && args.tab == null) args.tab = state.tab
        const reply = await state.executeTool(step.tool, args)
        const result = replyResult(reply)
        const error = reply.isError ? replyError(reply) : resultError(result)
        if (error) {
          return {
            ok: false,
            action: state.stack[0],
            stepsExecuted: state.stepsExecuted,
            error,
            callStack: [...state.stack],
            failedStep: { action: key, index, target: step.tool },
          }
        }
        state.lastResult = result
      } catch (err) {
        return {
          ok: false,
          action: state.stack[0],
          stepsExecuted: state.stepsExecuted,
          error: err instanceof Error ? err.message : String(err),
          callStack: [...state.stack],
          failedStep: { action: key, index, target: step.kind === 'tool' ? step.tool : actionKey(step.domain, step.name) },
        }
      }
    }
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
    tab: options.tab,
    executeTool: options.executeTool,
  }
  const failure = await runAction(options.domain, options.name, options.input ?? {}, state)
  if (failure) return failure
  return {
    ok: true,
    action: rootKey,
    stepsExecuted: state.stepsExecuted,
    ...(state.lastResult === undefined ? {} : { lastResult: state.lastResult }),
  }
}
