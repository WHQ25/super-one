import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import log from '../logger'
import type { MiniAppToolDefinition, MiniAppToolCallRequest, MiniAppToolInterceptOpenRequest } from '@superone/shared/miniapp-types'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { getPreapprovedByPath } from '../miniapp/miniapp-packager'
import { executeHeadlessTool } from '../miniapp/miniapp-worker-host'
import { trace } from '../agent/event-trace'
import { jsonSchemaToZodShape } from './json-schema-zod'
import {
  BUILT_IN_SUPERONE_TOOL_NAMES,
  registerSuperoneTools,
  type SessionTitleHost,
} from './superone-mcp-builtins'
import { registerWidgetTools } from '../generative-ui/mcp-server'

interface PendingCall {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  sessionId: string
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
  sessionId: string
  projectDir: string
  appId: string
  toolSlug: string
  tools: MiniAppToolDefinition[]
  headlessEntryAbsPath?: string
}

function describeTool(t: MiniAppToolDefinition): string {
  const base = t.description
  if (t.canCallWhileClosed) return base
  return `${base}\n\n(Note: this tool requires the mini-app's panel UI to be open to execute.)`
}

function makeAppKey(sessionId: string, appId: string): string {
  return `${sessionId}::${appId}`
}

function makeProjectAppKey(projectDir: string, appId: string): string {
  return `${projectDir}::${appId}`
}

const sessionServers = new Map<string, Set<ProjectServerState>>()
const appToolDefs = new Map<string, AppToolEntry>()
const appTemplates = new Map<string, Record<string, string>>()
const appReadyGates = new Map<string, GateEntry>()
const preapprovedTools = new Set<string>()
const pendingCalls = new Map<string, PendingCall>()

interface PendingIntercept {
  resolve: (userInput: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout> | null
  sessionId: string
}
const pendingIntercepts = new Map<string, PendingIntercept>()

let getMainWindow: (() => BrowserWindow | null) | null = null

interface ToolSyncCallbacks {
  toolsChanged: (sessionId: string) => void
}

let toolSync: ToolSyncCallbacks | null = null

export function setToolSyncCallbacks(callbacks: ToolSyncCallbacks | null): void {
  toolSync = callbacks
}

export function initSuperoneMcpServer(windowGetter: () => BrowserWindow | null): void {
  getMainWindow = windowGetter
}

let sessionHostProvider: (() => SessionTitleHost | null) | null = null

export function setSessionHostProvider(provider: (() => SessionTitleHost | null) | null): void {
  sessionHostProvider = provider
}

export function getSessionHost(): SessionTitleHost | null {
  return sessionHostProvider?.() ?? null
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

export function createSuperoneMcpServer(sessionId: string): McpSdkServerConfigWithInstance {
  const server = new McpServer({ name: 'superone', version: '1.0.0' })
  registerSuperoneTools(server, {
    notifyDevAppReady,
    sessionId,
    sessionHost: getSessionHost(),
  })
  registerWidgetTools(server)
  const state: ProjectServerState = { server, registeredTools: new Map() }

  let set = sessionServers.get(sessionId)
  if (!set) {
    set = new Set()
    sessionServers.set(sessionId, set)
  }
  set.add(state)

  for (const entry of appToolDefs.values()) {
    if (entry.sessionId === sessionId) {
      registerToolsOnState(state, entry.sessionId, entry.appId, entry.projectDir, entry.toolSlug, entry.tools, entry.headlessEntryAbsPath)
    }
  }

  const innerServer = (server as unknown as { server?: { onclose?: () => void } }).server
  if (innerServer) {
    const previousOnclose = innerServer.onclose
    innerServer.onclose = () => {
      previousOnclose?.()
      const current = sessionServers.get(sessionId)
      if (current) {
        current.delete(state)
        if (current.size === 0) sessionServers.delete(sessionId)
      }
      log.debug('[superone-mcp] disposed instance for sessionId=%s (remaining=%d)', sessionId, current?.size ?? 0)
    }
  }

  log.debug('[superone-mcp] created instance for sessionId=%s (total=%d)', sessionId, set.size)
  return { type: 'sdk' as const, name: 'superone', instance: server } as unknown as McpSdkServerConfigWithInstance
}

export function disposeSuperoneMcpServer(sessionId: string): void {
  sessionServers.delete(sessionId)
  log.debug('[superone-mcp] disposed all instances for sessionId=%s', sessionId)
}

const LAZY_OPEN_TIMEOUT_MS = 30_000

async function requestLazyOpenPanel(projectDir: string, appId: string, sessionId: string): Promise<void> {
  const win = getMainWindow?.()
  if (!win || win.isDestroyed()) {
    trace('miniapp.lazyopen', 'main-no-window', { appId, projectDir, sessionId })
    throw new Error('No renderer available for lazy-open')
  }
  trace('miniapp.lazyopen', 'main-ipc-send', { appId, projectDir, sessionId })
  win.webContents.send(AgentIpcChannels.MINIAPP_LAZY_OPEN_REQUEST, { appId, projectDir, sessionId })
  try {
    await Promise.race([
      waitForAppReady(projectDir, appId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Lazy-open timed out after ${LAZY_OPEN_TIMEOUT_MS}ms for app '${appId}'`)), LAZY_OPEN_TIMEOUT_MS),
      ),
    ])
    trace('miniapp.lazyopen', 'main-ready-unblocked', { appId, projectDir })
  } catch (err) {
    trace('miniapp.lazyopen', 'main-timeout-or-error', { appId, projectDir, error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

function isPanelReady(projectDir: string, appId: string): boolean {
  const key = makeProjectAppKey(projectDir, appId)
  return appReadyGates.get(key)?.ready === true
}

export function clearAppReadyGate(projectDir: string, appId: string): void {
  const key = makeProjectAppKey(projectDir, appId)
  const entry = appReadyGates.get(key)
  if (entry?.resolve) {
    entry.resolve()
  }
  appReadyGates.delete(key)
}

function registerToolsOnState(
  state: ProjectServerState,
  sessionId: string,
  appId: string,
  projectDir: string,
  toolSlug: string,
  tools: MiniAppToolDefinition[],
  headlessEntryAbsPath: string | undefined,
): void {
  for (const t of tools) {
    const namespacedName = `${toolSlug}__${t.name}`
    if (state.registeredTools.has(namespacedName)) continue

    const zodShape = jsonSchemaToZodShape(t.inputSchema)
    const isHeadless = t.canCallWhileClosed === true
    const registered = state.server.registerTool(
      namespacedName,
      { description: describeTool(t), inputSchema: zodShape },
      async (args: Record<string, unknown>) => {
        try {
          let result: unknown
          if (isHeadless) {
            if (!headlessEntryAbsPath) {
              throw new Error(`Tool '${t.name}' is declared canCallWhileClosed but app '${appId}' has no resolved headlessEntry`)
            }
            result = await executeHeadlessTool({
              sessionId,
              appId,
              headlessEntry: headlessEntryAbsPath,
              toolName: t.name,
              args,
              timeoutMs: t.timeoutMs,
            })
          } else {
            const panelReady = isPanelReady(projectDir, appId)
            trace('miniapp.lazyopen', 'tool-dispatch', { appId, toolName: t.name, panelReady })
            if (!panelReady) {
              log.info('[superone-mcp] panel not open for %s, triggering lazy-open', appId)
              await requestLazyOpenPanel(projectDir, appId, sessionId)
            }
            trace('miniapp.lazyopen', 'tool-execute-start', { appId, toolName: t.name })
            result = await executeAppTool(sessionId, appId, t.name, args)
            trace('miniapp.lazyopen', 'tool-execute-done', { appId, toolName: t.name })
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
        } catch (err) {
          return { content: [{ type: 'text' as const, text: `[Error] ${err instanceof Error ? err.message : String(err)}` }] }
        }
      },
    )
    state.registeredTools.set(namespacedName, registered)
    log.info('[superone-mcp] registered tool %s (headless=%s) for sessionId=%s', namespacedName, isHeadless, sessionId)
  }
}

export function registerAppTools(
  sessionId: string,
  projectDir: string,
  appId: string,
  toolSlug: string,
  tools: MiniAppToolDefinition[],
  headlessEntryAbsPath?: string,
): void {
  const key = makeAppKey(sessionId, appId)
  log.debug('[superone-mcp] registerAppTools sessionId=%s projectDir=%s appId=%s toolSlug=%s tools=%d headlessEntry=%s',
    sessionId, projectDir, appId, toolSlug, tools.length, headlessEntryAbsPath ?? 'none')
  appToolDefs.set(key, { sessionId, projectDir, appId, toolSlug, tools, headlessEntryAbsPath })

  toolSync?.toolsChanged(sessionId)

  const states = sessionServers.get(sessionId)
  if (!states || states.size === 0) {
    log.info('[superone-mcp] no active server for sessionId=%s; tools cached for %s', sessionId, appId)
    return
  }

  for (const state of states) {
    registerToolsOnState(state, sessionId, appId, projectDir, toolSlug, tools, headlessEntryAbsPath)
    if (state.server.isConnected()) state.server.sendToolListChanged()
  }
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

export function unregisterAppTools(sessionId: string, appId: string): void {
  const key = makeAppKey(sessionId, appId)
  const entry = appToolDefs.get(key)
  const toolSlug = entry?.toolSlug ?? appId
  appToolDefs.delete(key)

  const prefix = `${toolSlug}__`
  const states = sessionServers.get(sessionId)
  if (states) {
    for (const state of states) {
      for (const [name, tool] of state.registeredTools) {
        if (name.startsWith(prefix)) {
          tool.remove()
          state.registeredTools.delete(name)
          log.info('[superone-mcp] unregistered tool %s for sessionId=%s', name, sessionId)
        }
      }
      if (state.server.isConnected()) state.server.sendToolListChanged()
    }
  }

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

  toolSync?.toolsChanged(sessionId)
}

/**
 * Unregister all mini-app tools held by a given session. Used when a session
 * is destroyed (project close, /reset, session removal) — at that point the
 * agent owning these tool slots is going away so the entire authorization set
 * for this session is dropped at once. Returns the list of (projectDir, appId)
 * tuples that were cleaned up so callers can run side-effect cleanup
 * (templates, fs permissions) without having to iterate again.
 */
export function unregisterSessionAllApps(sessionId: string): Array<{ projectDir: string; appId: string }> {
  const targets: Array<{ projectDir: string; appId: string }> = []
  for (const entry of appToolDefs.values()) {
    if (entry.sessionId === sessionId) {
      targets.push({ projectDir: entry.projectDir, appId: entry.appId })
    }
  }
  for (const { appId } of targets) unregisterAppTools(sessionId, appId)
  return targets
}

/**
 * Unregister a specific app across all sessions that currently have it
 * authorized. Used when the app is being uninstalled — every active session
 * must drop the tools since the underlying code is going away.
 */
export function unregisterAppAcrossSessions(appId: string): string[] {
  const sessionIds: string[] = []
  for (const entry of appToolDefs.values()) {
    if (entry.appId === appId && !sessionIds.includes(entry.sessionId)) {
      sessionIds.push(entry.sessionId)
    }
  }
  for (const sid of sessionIds) unregisterAppTools(sid, appId)
  return sessionIds
}

/**
 * True if any session still has (projectDir, appId) authorized after recent
 * cleanup. Used to gate per-project resource teardown (templates, fs perms)
 * that's shared across sessions in the same project.
 */
export function isAppStillAuthorizedInProject(projectDir: string, appId: string): boolean {
  for (const entry of appToolDefs.values()) {
    if (entry.projectDir === projectDir && entry.appId === appId) return true
  }
  return false
}

export function resolveToolCall(callId: string, result: unknown): void {
  const pending = pendingCalls.get(callId)
  if (pending) {
    clearTimeout(pending.timer)
    pendingCalls.delete(callId)
    log.debug('[superone-mcp] tool call resolved callId=%s', callId)
    trace('miniapp.toolcall', 'main-resolve', { callId })
    pending.resolve(result)
  } else {
    log.warn('[superone-mcp] resolveToolCall miss (no pending) callId=%s', callId)
    trace('miniapp.toolcall', 'main-resolve-miss', { callId })
  }
}

export function rejectToolCall(callId: string, error: string): void {
  const pending = pendingCalls.get(callId)
  if (pending) {
    clearTimeout(pending.timer)
    pendingCalls.delete(callId)
    log.debug('[superone-mcp] tool call rejected callId=%s error=%s', callId, error)
    trace('miniapp.toolcall', 'main-reject', { callId, error })
    pending.reject(new Error(error))
  } else {
    log.warn('[superone-mcp] rejectToolCall miss (no pending) callId=%s', callId)
    trace('miniapp.toolcall', 'main-reject-miss', { callId, error })
  }
}

export function notifyAppReady(projectDir: string, appId: string): void {
  const key = makeProjectAppKey(projectDir, appId)
  const entry = appReadyGates.get(key)
  if (entry?.resolve) {
    const elapsed = Date.now() - entry.startMs
    log.info('[superone-mcp] app ready: %s @ %s (%dms)', appId, projectDir, elapsed)
    trace('miniapp.lazyopen', 'main-ready-resolve-pending', { appId, projectDir, elapsedMs: elapsed })
    appReadyGates.set(key, { startMs: entry.startMs, ready: true })
    entry.resolve()
  } else {
    log.info('[superone-mcp] app ready (early): %s @ %s', appId, projectDir)
    trace('miniapp.lazyopen', 'main-ready-early-stash', { appId, projectDir })
    appReadyGates.set(key, { startMs: Date.now(), ready: true })
  }
}

function waitForAppReady(projectDir: string, appId: string): Promise<void> {
  const key = makeProjectAppKey(projectDir, appId)
  const existing = appReadyGates.get(key)
  if (existing?.ready) {
    return Promise.resolve()
  }
  const startMs = existing?.startMs ?? Date.now()
  return new Promise<void>((resolve) => {
    appReadyGates.set(key, { resolve, startMs, ready: false })
  })
}

export function clearSessionPendingCalls(sessionId: string): void {
  for (const [callId, pending] of pendingCalls) {
    if (pending.sessionId !== sessionId) continue
    clearTimeout(pending.timer)
    pending.reject(new Error('Pending calls cleared for session'))
    pendingCalls.delete(callId)
  }
  const clearedInterceptCallIds: string[] = []
  for (const [callId, p] of pendingIntercepts) {
    if (p.sessionId !== sessionId) continue
    if (p.timer) clearTimeout(p.timer)
    p.reject(new Error('Pending calls cleared for session'))
    pendingIntercepts.delete(callId)
    clearedInterceptCallIds.push(callId)
  }
  if (clearedInterceptCallIds.length > 0) {
    const win = getMainWindow?.()
    if (win && !win.isDestroyed()) {
      win.webContents.send(AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_CLEAR, sessionId, clearedInterceptCallIds)
    }
  }
}

export function registerAppTemplates(projectDir: string, appId: string, templates: Record<string, string> | undefined): void {
  const key = makeProjectAppKey(projectDir, appId)
  if (templates && Object.keys(templates).length > 0) {
    appTemplates.set(key, templates)
  } else {
    appTemplates.delete(key)
  }
}

export function unregisterAppTemplates(projectDir: string, appId: string): void {
  appTemplates.delete(makeProjectAppKey(projectDir, appId))
}

function mergeInterceptInput(
  agentInput: Record<string, unknown>,
  userInput: Record<string, unknown>,
  strategy: 'shallow-merge' | 'replace',
): Record<string, unknown> {
  if (strategy === 'replace') return userInput
  return { ...agentInput, ...userInput }
}

function openInterceptRenderer(req: MiniAppToolInterceptOpenRequest, sessionId: string, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        pendingIntercepts.delete(req.callId)
        reject(new Error(`Intercept timeout after ${timeoutMs}ms: ${req.toolName}`))
      }, timeoutMs)
    }
    pendingIntercepts.set(req.callId, { resolve, reject, timer, sessionId })
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
  sessionId: string,
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

    pendingCalls.set(callId, { resolve, reject, timer, sessionId })

    const win = getMainWindow?.()
    if (!win || win.isDestroyed()) {
      pendingCalls.delete(callId)
      clearTimeout(timer)
      reject(new Error('Main window not available'))
      return
    }

    log.debug('[superone-mcp] tool call dispatched callId=%s projectDir=%s appId=%s toolName=%s', callId, projectDir, appId, toolName)
    trace('miniapp.toolcall', 'main-dispatch', { callId, appId, toolName, projectDir })
    win.webContents.send(AgentIpcChannels.MINIAPP_TOOL_CALL, request)
  })
}

export async function executeAppTool(
  sessionId: string,
  appId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const key = makeAppKey(sessionId, appId)
  const defsEntry = appToolDefs.get(key)
  if (!defsEntry) {
    throw new Error(`App "${appId}" is not open in session "${sessionId}". This tool is no longer available.`)
  }
  const projectDir = defsEntry.projectDir

  log.debug('[superone-mcp] executeAppTool begin sessionId=%s projectDir=%s appId=%s toolName=%s', sessionId, projectDir, appId, toolName)
  await waitForAppReady(projectDir, appId)

  const toolDef = defsEntry.tools.find((t) => t.name === toolName)
  const intercept = toolDef?.renderer?.intercept
  const callId = randomUUID()

  let finalInput = args
  if (intercept) {
    const templates = appTemplates.get(makeProjectAppKey(projectDir, appId))
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
      }, sessionId, timeoutMs)
      finalInput = mergeInterceptInput(args, userInput, intercept.inputMerge ?? 'shallow-merge')
    } catch (err) {
      if (intercept.onCancel === 'resolve-empty') {
        return { cancelled: true, reason: err instanceof Error ? err.message : String(err) }
      }
      throw err
    }
  }

  return sendToolCall(callId, sessionId, projectDir, appId, toolName, finalInput)
}

export function getAppToolDefs(): Map<string, AppToolEntry> {
  return appToolDefs
}
