import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import log from '../logger'
import type { MiniAppToolDefinition, MiniAppToolCallRequest, MiniAppToolInterceptOpenRequest } from '@superone/shared/miniapp-types'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { getPreapprovedByPath } from '../miniapp/miniapp-packager'
import { jsonSchemaToZodShape } from './json-schema-zod'
import {
  BUILT_IN_SUPERONE_TOOL_NAMES,
  registerSuperoneTools,
} from './superone-mcp-builtins'

interface PendingCall {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  projectDir: string
}

interface GateEntry {
  resolve?: () => void
  startMs: number
  ready: boolean
}

const TOOL_CALL_TIMEOUT_MS = 60_000

interface ProjectServerState {
  server: McpServer
  registeredTools: Map<string, RegisteredTool>
}

interface AppToolEntry {
  projectDir: string
  appId: string
  toolSlug: string
  tools: MiniAppToolDefinition[]
}

function makeAppKey(projectDir: string, appId: string): string {
  return `${projectDir}::${appId}`
}

const projectServers = new Map<string, ProjectServerState>()
const appToolDefs = new Map<string, AppToolEntry>()
const appTemplates = new Map<string, Record<string, string>>()
const appReadyGates = new Map<string, GateEntry>()
const preapprovedTools = new Set<string>()
const pendingCalls = new Map<string, PendingCall>()

interface PendingIntercept {
  resolve: (userInput: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout> | null
  projectDir: string
}
const pendingIntercepts = new Map<string, PendingIntercept>()

let getMainWindow: (() => BrowserWindow | null) | null = null

interface ToolSyncCallbacks {
  toolsChanged: (projectDir: string) => void
}

let toolSync: ToolSyncCallbacks | null = null

export function setToolSyncCallbacks(callbacks: ToolSyncCallbacks | null): void {
  toolSync = callbacks
}

export function initSuperoneMcpServer(windowGetter: () => BrowserWindow | null): void {
  getMainWindow = windowGetter
}

export function notifyDevAppReady(projectDir: string, appId: string): void {
  const win = getMainWindow?.()
  if (win && !win.isDestroyed()) {
    win.webContents.send(AgentIpcChannels.MINIAPP_DEV_APP_READY, projectDir, appId)
  }
}

const BUILT_IN_QUALIFIED_NAMES = new Set(
  BUILT_IN_SUPERONE_TOOL_NAMES.map((n) => `mcp__superone__${n}`),
)

export function isBuiltInSuperoneTool(qualifiedName: string): boolean {
  return BUILT_IN_QUALIFIED_NAMES.has(qualifiedName)
}

export function getSuperoneMcpServer(projectPath: string): McpSdkServerConfigWithInstance {
  const existing = projectServers.get(projectPath)
  if (existing) {
    return { type: 'sdk' as const, name: 'superone', instance: existing.server } as unknown as McpSdkServerConfigWithInstance
  }

  const server = new McpServer({ name: 'superone', version: '1.0.0' })
  registerSuperoneTools(server, { notifyDevAppReady })
  const state: ProjectServerState = { server, registeredTools: new Map() }
  projectServers.set(projectPath, state)

  for (const entry of appToolDefs.values()) {
    if (entry.projectDir === projectPath) {
      registerToolsOnState(state, entry.projectDir, entry.appId, entry.toolSlug, entry.tools)
    }
  }

  log.debug('[superone-mcp] created server for projectPath=%s', projectPath)
  return { type: 'sdk' as const, name: 'superone', instance: server } as unknown as McpSdkServerConfigWithInstance
}

export function disposeSuperoneMcpServer(projectPath: string): void {
  projectServers.delete(projectPath)
  log.debug('[superone-mcp] disposed server for projectPath=%s', projectPath)
}

function registerToolsOnState(
  state: ProjectServerState,
  projectDir: string,
  appId: string,
  toolSlug: string,
  tools: MiniAppToolDefinition[],
): void {
  for (const t of tools) {
    const namespacedName = `${toolSlug}__${t.name}`
    if (state.registeredTools.has(namespacedName)) continue

    const zodShape = jsonSchemaToZodShape(t.inputSchema)
    const registered = state.server.registerTool(
      namespacedName,
      { description: t.description, inputSchema: zodShape },
      async (args: Record<string, unknown>) => {
        try {
          const result = await executeAppTool(projectDir, appId, t.name, args)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
        } catch (err) {
          return { content: [{ type: 'text' as const, text: `[Error] ${err instanceof Error ? err.message : String(err)}` }] }
        }
      },
    )
    state.registeredTools.set(namespacedName, registered)
    log.info('[superone-mcp] registered tool %s for projectPath=%s', namespacedName, projectDir)
  }
}

export function registerAppTools(
  projectDir: string,
  appId: string,
  toolSlug: string,
  tools: MiniAppToolDefinition[],
): void {
  const key = makeAppKey(projectDir, appId)
  log.debug('[superone-mcp] registerAppTools projectDir=%s appId=%s toolSlug=%s tools=%d', projectDir, appId, toolSlug, tools.length)
  appToolDefs.set(key, { projectDir, appId, toolSlug, tools })

  toolSync?.toolsChanged(projectDir)

  const state = projectServers.get(projectDir)
  if (!state) {
    log.info('[superone-mcp] no active server for projectDir=%s; tools cached for %s', projectDir, appId)
    return
  }

  registerToolsOnState(state, projectDir, appId, toolSlug, tools)
  state.server.sendToolListChanged()
}

export async function loadPreapprovedTools(
  appId: string,
  toolSlug: string,
  basePath: string,
): Promise<void> {
  const tools = await getPreapprovedByPath(basePath)
  for (const t of tools) {
    preapprovedTools.add(`${toolSlug}__${t}`)
  }
  void appId
}

export function updatePreapprovedTools(appId: string, tools: string[]): void {
  let toolSlug: string | null = null
  for (const entry of appToolDefs.values()) {
    if (entry.appId === appId) {
      toolSlug = entry.toolSlug
      break
    }
  }
  if (!toolSlug) toolSlug = appId
  const prefix = `${toolSlug}__`
  for (const name of [...preapprovedTools]) {
    if (name.startsWith(prefix)) preapprovedTools.delete(name)
  }
  for (const t of tools) {
    preapprovedTools.add(`${prefix}${t}`)
  }
}

const MCP_SUPERONE_PREFIX = 'mcp__superone__'

export function isToolPreapproved(toolName: string): boolean {
  if (!toolName.startsWith(MCP_SUPERONE_PREFIX)) return false
  const namespacedName = toolName.slice(MCP_SUPERONE_PREFIX.length)
  return preapprovedTools.has(namespacedName)
}

export function unregisterAppTools(projectDir: string, appId: string): void {
  const key = makeAppKey(projectDir, appId)
  const entry = appToolDefs.get(key)
  const toolSlug = entry?.toolSlug ?? appId
  appToolDefs.delete(key)

  const prefix = `${toolSlug}__`
  const state = projectServers.get(projectDir)
  if (state) {
    for (const [name, tool] of state.registeredTools) {
      if (name.startsWith(prefix)) {
        tool.remove()
        state.registeredTools.delete(name)
        log.info('[superone-mcp] unregistered tool %s for projectPath=%s', name, projectDir)
      }
    }
    state.server.sendToolListChanged()
  }

  appReadyGates.delete(key)

  let stillOpen = false
  for (const e of appToolDefs.values()) {
    if (e.appId === appId) {
      stillOpen = true
      break
    }
  }
  if (!stillOpen) {
    for (const name of [...preapprovedTools]) {
      if (name.startsWith(prefix)) preapprovedTools.delete(name)
    }
  }

  toolSync?.toolsChanged(projectDir)
}

export function resolveToolCall(callId: string, result: unknown): void {
  const pending = pendingCalls.get(callId)
  if (pending) {
    clearTimeout(pending.timer)
    pendingCalls.delete(callId)
    log.debug('[superone-mcp] tool call resolved callId=%s', callId)
    pending.resolve(result)
  } else {
    log.warn('[superone-mcp] resolveToolCall miss (no pending) callId=%s', callId)
  }
}

export function rejectToolCall(callId: string, error: string): void {
  const pending = pendingCalls.get(callId)
  if (pending) {
    clearTimeout(pending.timer)
    pendingCalls.delete(callId)
    log.debug('[superone-mcp] tool call rejected callId=%s error=%s', callId, error)
    pending.reject(new Error(error))
  } else {
    log.warn('[superone-mcp] rejectToolCall miss (no pending) callId=%s', callId)
  }
}

export function notifyAppReady(projectDir: string, appId: string): void {
  const key = makeAppKey(projectDir, appId)
  const entry = appReadyGates.get(key)
  if (entry?.resolve) {
    const elapsed = Date.now() - entry.startMs
    log.info('[superone-mcp] app ready: %s @ %s (%dms)', appId, projectDir, elapsed)
    appReadyGates.delete(key)
    entry.resolve()
  } else {
    log.info('[superone-mcp] app ready (early): %s @ %s', appId, projectDir)
    appReadyGates.set(key, { startMs: Date.now(), ready: true })
  }
}

function waitForAppReady(projectDir: string, appId: string): Promise<void> {
  const key = makeAppKey(projectDir, appId)
  const existing = appReadyGates.get(key)
  if (existing?.ready) {
    return Promise.resolve()
  }
  const startMs = existing?.startMs ?? Date.now()
  return new Promise<void>((resolve) => {
    appReadyGates.set(key, { resolve, startMs, ready: false })
  })
}

export function clearProjectPendingCalls(projectDir: string): void {
  for (const [callId, pending] of pendingCalls) {
    if (pending.projectDir !== projectDir) continue
    clearTimeout(pending.timer)
    pending.reject(new Error('Pending calls cleared for project'))
    pendingCalls.delete(callId)
  }
  const clearedInterceptCallIds: string[] = []
  for (const [callId, p] of pendingIntercepts) {
    if (p.projectDir !== projectDir) continue
    if (p.timer) clearTimeout(p.timer)
    p.reject(new Error('Pending calls cleared for project'))
    pendingIntercepts.delete(callId)
    clearedInterceptCallIds.push(callId)
  }
  if (clearedInterceptCallIds.length > 0) {
    const win = getMainWindow?.()
    if (win && !win.isDestroyed()) {
      win.webContents.send(AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_CLEAR, projectDir, clearedInterceptCallIds)
    }
  }
}

export function registerAppTemplates(projectDir: string, appId: string, templates: Record<string, string> | undefined): void {
  const key = makeAppKey(projectDir, appId)
  if (templates && Object.keys(templates).length > 0) {
    appTemplates.set(key, templates)
  } else {
    appTemplates.delete(key)
  }
}

export function unregisterAppTemplates(projectDir: string, appId: string): void {
  appTemplates.delete(makeAppKey(projectDir, appId))
}

function mergeInterceptInput(
  agentInput: Record<string, unknown>,
  userInput: Record<string, unknown>,
  strategy: 'shallow-merge' | 'replace',
): Record<string, unknown> {
  if (strategy === 'replace') return userInput
  return { ...agentInput, ...userInput }
}

function openInterceptRenderer(req: MiniAppToolInterceptOpenRequest, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        pendingIntercepts.delete(req.callId)
        reject(new Error(`Intercept timeout after ${timeoutMs}ms: ${req.toolName}`))
      }, timeoutMs)
    }
    pendingIntercepts.set(req.callId, { resolve, reject, timer, projectDir: req.projectDir })
    const win = getMainWindow?.()
    if (!win || win.isDestroyed()) {
      if (timer) clearTimeout(timer)
      pendingIntercepts.delete(req.callId)
      reject(new Error('Main window not available'))
      return
    }
    try {
      win.webContents.send(AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_OPEN, req)
    } catch (err) {
      if (timer) clearTimeout(timer)
      pendingIntercepts.delete(req.callId)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

function settleIntercept(callId: string, outcome: { userInput: Record<string, unknown> } | { error: Error }): void {
  const p = pendingIntercepts.get(callId)
  if (!p) return
  if (p.timer) clearTimeout(p.timer)
  pendingIntercepts.delete(callId)
  if ('userInput' in outcome) p.resolve(outcome.userInput)
  else p.reject(outcome.error)
}

export function submitToolIntercept(callId: string, userInput: Record<string, unknown>): void {
  settleIntercept(callId, { userInput })
}

export function cancelToolIntercept(callId: string, reason?: string): void {
  settleIntercept(callId, { error: new Error(reason ?? 'user_cancelled') })
}

function sendToolCall(
  callId: string,
  projectDir: string,
  appId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const request: MiniAppToolCallRequest = { callId, appId, projectDir, toolName, arguments: args }
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(callId)
      log.warn('[superone-mcp] tool call timeout callId=%s projectDir=%s appId=%s toolName=%s', callId, projectDir, appId, toolName)
      reject(new Error(`Tool call timeout after ${TOOL_CALL_TIMEOUT_MS}ms: ${toolName}`))
    }, TOOL_CALL_TIMEOUT_MS)

    pendingCalls.set(callId, { resolve, reject, timer, projectDir })

    const win = getMainWindow?.()
    if (!win || win.isDestroyed()) {
      pendingCalls.delete(callId)
      clearTimeout(timer)
      reject(new Error('Main window not available'))
      return
    }

    log.debug('[superone-mcp] tool call dispatched callId=%s projectDir=%s appId=%s toolName=%s', callId, projectDir, appId, toolName)
    win.webContents.send(AgentIpcChannels.MINIAPP_TOOL_CALL, request)
  })
}

export async function executeAppTool(
  projectDir: string,
  appId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const key = makeAppKey(projectDir, appId)
  const defsEntry = appToolDefs.get(key)
  if (!defsEntry) {
    throw new Error(`App "${appId}" is not open in project "${projectDir}". This tool is no longer available.`)
  }

  log.debug('[superone-mcp] executeAppTool begin projectDir=%s appId=%s toolName=%s', projectDir, appId, toolName)
  await waitForAppReady(projectDir, appId)

  const toolDef = defsEntry.tools.find((t) => t.name === toolName)
  const intercept = toolDef?.renderer?.intercept
  const callId = randomUUID()

  let finalInput = args
  if (intercept) {
    const templates = appTemplates.get(key)
    const templatePath = templates?.[intercept.template]
    if (!templatePath) {
      throw new Error(`Template "${intercept.template}" not found in manifest.templates`)
    }
    try {
      const timeoutMs = intercept.timeoutMs ?? TOOL_CALL_TIMEOUT_MS
      const userInput = await openInterceptRenderer({
        callId,
        appId,
        projectDir,
        toolSlug: defsEntry.toolSlug,
        toolName,
        agentInput: args,
        template: intercept.template,
        templatePath,
      }, timeoutMs)
      finalInput = mergeInterceptInput(args, userInput, intercept.inputMerge ?? 'shallow-merge')
    } catch (err) {
      if (intercept.onCancel === 'resolve-empty') {
        return { cancelled: true, reason: err instanceof Error ? err.message : String(err) }
      }
      throw err
    }
  }

  return sendToolCall(callId, projectDir, appId, toolName, finalInput)
}

export function getAppToolDefs(): Map<string, AppToolEntry> {
  return appToolDefs
}
