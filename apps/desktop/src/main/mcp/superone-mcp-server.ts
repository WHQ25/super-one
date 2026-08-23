import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import log from '../logger'
import type { MiniAppToolDefinition, MiniAppToolInterceptOpenRequest } from '@superone/shared/miniapp-types'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { getPreapprovedByPath } from '../miniapp/miniapp-packager'
import { trace } from '../agent/event-trace'
import { jsonSchemaToZodShape } from './json-schema-zod'
import {
  registerSuperoneTools,
  type BuiltInSuperoneToolDeps,
  type SessionTitleHost,
} from './superone-mcp-builtins'
import {
  MOBILE_SHARE_FILE_TOOL_NAME,
  MOBILE_SHARE_FILE_DESCRIPTION,
  MOBILE_SHARE_FILE_INPUT_SCHEMA,
} from './superone-mcp-builtin-defs'
import { registerWidgetTools } from '../generative-ui/mcp-server'
import { clearBrowserToolHandlers, registerBrowserTools } from './browser-mcp-tools'
import { registerComputerUseTools } from '../computer-use/tools'
import {
  executeDeviceAgentTool,
  registerDeviceAgentTools,
  setDeviceAgentHostEventResolver,
} from '../device-agent'
import { computerUseQualifiedNames } from '../computer-use/harness-surface'
import { isBuiltInSuperoneToolQualified, MCP_SUPERONE_TOOL_PREFIX } from './superone-host-owned-tools'
import {
  setMiniappPreapproveLookup,
  shouldAutoAllowMiniappTool,
} from './miniapp-call-policy'
import {
  registerMiniappTools,
  type MiniappToolDeps,
} from './miniapp-mcp-tools'

export interface MobileShareToolResult {
  ok: boolean
  error?: string
  shareId?: string
  name?: string
  size?: number
  mimeType?: string
  deviceName?: string
  sentAt?: number
  path?: string
  transport?: 'inline' | 'relay'
  expiresAt?: number
}

export interface MobileShareToolDeps {
  shareFile(req: { sessionId: string; path: string; caption?: string }): Promise<MobileShareToolResult>
}

let mobileShareDeps: MobileShareToolDeps | null = null

export function setMobileShareToolDeps(deps: MobileShareToolDeps | null): void {
  mobileShareDeps = deps
}

const mobileShareEnabled = new Set<string>()

const TOOL_INTERCEPT_TIMEOUT_MS = 10_000

interface ProjectServerState {
  server: McpServer
  registeredTools: Map<string, RegisteredTool>
}

interface AppToolEntry {
  sessionId: string
  projectDir: string
  appId: string
  tools: MiniAppToolDefinition[]
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
/** Keys: `appId::toolName`. */
const preapprovedTools = new Set<string>()

function isAppToolPreapproved(appId: string, toolName: string): boolean {
  return preapprovedTools.has(`${appId}::${toolName}`)
}

/** Runtime alwaysAllow / test helper. */
export function markAppToolPreapproved(appId: string, toolName: string): void {
  preapprovedTools.add(`${appId}::${toolName}`)
}

/** Test/export for executor preapprove checks. */
export function isAppToolPreapprovedForSession(appId: string, toolName: string): boolean {
  return isAppToolPreapproved(appId, toolName)
}

setMiniappPreapproveLookup({
  isAppToolPreapproved,
})

export function getAuthorizedAppsForSession(sessionId: string): Array<{
  appId: string
  tools: MiniAppToolDefinition[]
}> {
  const out: Array<{ appId: string; tools: MiniAppToolDefinition[] }> = []
  for (const entry of appToolDefs.values()) {
    if (entry.sessionId !== sessionId) continue
    out.push({ appId: entry.appId, tools: entry.tools })
  }
  return out
}

export function getAppToolEntryForSession(
  sessionId: string,
  appId: string,
): { projectDir: string; tools: MiniAppToolDefinition[] } | null {
  const entry = appToolDefs.get(makeAppKey(sessionId, appId))
  if (!entry) return null
  return { projectDir: entry.projectDir, tools: entry.tools }
}

export function miniappToolDepsForSurface(): MiniappToolDeps {
  return {
    getAuthorizedApps: getAuthorizedAppsForSession,
    getAppEntry: getAppToolEntryForSession,
    dispatchAppToolCall,
    isAppToolPreapproved,
    markAppToolPreapproved,
    getEmitHostEvent: (sessionId) => {
      const session = getSessionHost()?.getSession(sessionId)
      if (!session?.emitHostEvent) return null
      return (event) => session.emitHostEvent!(event)
    },
  }
}

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

const toolsChangedListeners = new Set<(sessionId: string) => void>()

/**
 * Subscribe to per-session tool-set changes. Used by the Codex path to trigger a
 * `config/mcpServer/reload` so the agent picks up dynamically added/removed app
 * tools (Codex snapshots tools once per thread and ignores `tools/list_changed`).
 */
export function addToolsChangedListener(listener: (sessionId: string) => void): () => void {
  toolsChangedListeners.add(listener)
  return () => { toolsChangedListeners.delete(listener) }
}

function emitToolsChanged(sessionId: string): void {
  toolSync?.toolsChanged(sessionId)
  for (const listener of toolsChangedListeners) {
    try {
      listener(sessionId)
    } catch (err) {
      log.warn('[superone-mcp] toolsChanged listener error: %s', err instanceof Error ? err.message : String(err))
    }
  }
}

/**
 * Push a tools/list_changed notification for a session's SuperOne MCP surface
 * (stdio bridge for ACP/Codex + in-process listeners). Used when experimental
 * collaboration tools are toggled so existing runtimes re-list without restart.
 */
export function notifySessionToolsChanged(sessionId: string): void {
  emitToolsChanged(sessionId)
  const states = sessionServers.get(sessionId)
  if (!states) return
  for (const state of states) {
    if (state.server.isConnected()) {
      try {
        state.server.sendToolListChanged()
      } catch (err) {
        log.debug(
          '[superone-mcp] sendToolListChanged failed sid=%s: %s',
          sessionId,
          err instanceof Error ? err.message : String(err),
        )
      }
    }
  }
}

export function initSuperoneMcpServer(windowGetter: () => BrowserWindow | null): void {
  getMainWindow = windowGetter
}

let sessionHostProvider: (() => SessionTitleHost | null) | null = null

export function setSessionHostProvider(provider: (() => SessionTitleHost | null) | null): void {
  sessionHostProvider = provider
  // device_request_control prompts the user from inside its executor, which lives a
  // layer below this one. Handing it the resolver here — rather than letting it
  // import getSessionHost — keeps that dependency pointing one way.
  setDeviceAgentHostEventResolver((sessionId) => {
    const session = sessionHostProvider?.()?.getSession(sessionId)
    if (!session?.emitHostEvent) return null
    return (event) => session.emitHostEvent!(event)
  })
}

export function getSessionHost(): SessionTitleHost | null {
  return sessionHostProvider?.() ?? null
}

type AppSettingsApplier = BuiltInSuperoneToolDeps['applyAppSettings']

let appSettingsApplier: AppSettingsApplier | null = null

export function setAppSettingsApplier(applier: AppSettingsApplier | null): void {
  appSettingsApplier = applier
}

export function getAppSettingsApplier(): AppSettingsApplier {
  return appSettingsApplier ?? (() => { throw new Error('App settings applier is not registered') })
}

export function notifyDevAppReady(projectDir: string, appId: string): void {
  const win = getMainWindow?.()
  if (win && !win.isDestroyed()) {
    win.webContents.send(AgentIpcChannels.MINIAPP_DEV_APP_READY, projectDir, appId)
  }
}

/** Host-owned SuperOne tools — single source: superone-host-owned-tools.ts */
export function isBuiltInSuperoneTool(qualifiedName: string): boolean {
  return isBuiltInSuperoneToolQualified(qualifiedName)
}

/** Test/debug: full set of SuperOne-owned computer tool qualified names. */
export function listComputerUseQualifiedNames(): string[] {
  return computerUseQualifiedNames()
}

export function createSuperoneMcpServer(sessionId: string, projectPath?: string): McpSdkServerConfigWithInstance {
  const server = new McpServer({ name: 'superone', version: '1.0.0' })
  registerSuperoneTools(server, {
    notifyDevAppReady,
    sessionId,
    sessionHost: getSessionHost(),
    applyAppSettings: getAppSettingsApplier(),
  })
  registerWidgetTools(server, { projectPath, sessionId })
  registerBrowserTools(server, sessionId)
  // Opt-in desktop Computer Use (coordinate/AX fallback tier). Gated by settings.
  registerComputerUseTools(server, sessionId)
  registerDeviceAgentTools(server, sessionId, executeDeviceAgentTool)
  // Fixed mini-app surface — no per-app dynamic MCP tools.
  registerMiniappTools(server, sessionId, miniappToolDepsForSurface())
  const state: ProjectServerState = { server, registeredTools: new Map() }

  let set = sessionServers.get(sessionId)
  if (!set) {
    set = new Set()
    sessionServers.set(sessionId, set)
  }
  set.add(state)

  if (mobileShareEnabled.has(sessionId)) {
    registerMobileShareToolOnState(state, sessionId)
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
  clearBrowserToolHandlers(sessionId)
  // Do not clear the browser-tool surface lock here. This function also runs
  // when Computer Use is toggled (MCP rebuild for a still-live session).
  log.debug('[superone-mcp] disposed all instances for sessionId=%s', sessionId)
}

type AppToolExecutor = (
  projectDir: string,
  appId: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<unknown>

let appToolExecutor: AppToolExecutor | null = null

export function setAppToolExecutor(executor: AppToolExecutor): void {
  appToolExecutor = executor
}

function executeInMiniAppHost(
  projectDir: string,
  appId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!appToolExecutor) throw new Error('Mini-app MiniApp Host is unavailable')
  return appToolExecutor(projectDir, appId, toolName, args)
}

function registerMobileShareToolOnState(state: ProjectServerState, sessionId: string): void {
  if (state.registeredTools.has(MOBILE_SHARE_FILE_TOOL_NAME)) return
  const zodShape = jsonSchemaToZodShape(MOBILE_SHARE_FILE_INPUT_SCHEMA)
  const registered = state.server.registerTool(
    MOBILE_SHARE_FILE_TOOL_NAME,
    { description: MOBILE_SHARE_FILE_DESCRIPTION, inputSchema: zodShape },
    async (args: Record<string, unknown>) => executeMobileShareFileTool(sessionId, args),
  )
  state.registeredTools.set(MOBILE_SHARE_FILE_TOOL_NAME, registered)
}

export function isMobileShareToolEnabled(sessionId: string): boolean {
  return mobileShareEnabled.has(sessionId)
}

/** Execute mobile_share_file for ACP/stdio bridge (same handler as in-process MCP). */
export async function executeMobileShareFileTool(
  sessionId: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  if (!mobileShareDeps) {
    return {
      content: [{ type: 'text', text: '[Error] Mobile sharing is unavailable.' }],
      isError: true,
    }
  }
  const result = await mobileShareDeps.shareFile({
    sessionId,
    path: String(args.path ?? ''),
    caption: args.caption != null ? String(args.caption) : undefined,
  })
  if (!result.ok) {
    return {
      content: [{ type: 'text', text: `[Error] ${result.error ?? 'Failed to share file.'}` }],
      isError: true,
    }
  }
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

export function registerMobileShareTool(sessionId: string): void {
  if (mobileShareEnabled.has(sessionId)) return
  mobileShareEnabled.add(sessionId)
  log.debug('[superone-mcp] enable mobile_share_file for sessionId=%s', sessionId)
  emitToolsChanged(sessionId)
  const states = sessionServers.get(sessionId)
  if (!states) return
  for (const state of states) {
    registerMobileShareToolOnState(state, sessionId)
    if (state.server.isConnected()) state.server.sendToolListChanged()
  }
}

export function unregisterMobileShareTool(sessionId: string): void {
  if (!mobileShareEnabled.delete(sessionId)) return
  log.debug('[superone-mcp] disable mobile_share_file for sessionId=%s', sessionId)
  emitToolsChanged(sessionId)
  const states = sessionServers.get(sessionId)
  if (!states) return
  for (const state of states) {
    const registered = state.registeredTools.get(MOBILE_SHARE_FILE_TOOL_NAME)
    if (registered) {
      try { registered.remove() } catch (err) { log.debug('[superone-mcp] mobile_share_file remove error: %s', err instanceof Error ? err.message : String(err)) }
      state.registeredTools.delete(MOBILE_SHARE_FILE_TOOL_NAME)
    }
    if (state.server.isConnected()) state.server.sendToolListChanged()
  }
}

/**
 * Cache which mini-apps (and their tool manifests) are authorized for a session.
 * Does NOT mutate the MCP tool list — that surface is the fixed miniapp_list /
 * miniapp_call pair. Agents discover tools via miniapp_list.
 */
export function registerAppTools(
  sessionId: string,
  projectDir: string,
  appId: string,
  tools: MiniAppToolDefinition[],
): void {
  const key = makeAppKey(sessionId, appId)
  log.debug('[superone-mcp] registerAppTools sessionId=%s projectDir=%s appId=%s tools=%d',
    sessionId, projectDir, appId, tools.length)
  appToolDefs.set(key, { sessionId, projectDir, appId, tools })
  log.info(
    '[superone-mcp] authorized mini-app sessionId=%s appId=%s tools=%d (fixed MCP surface)',
    sessionId,
    appId,
    tools.length,
  )
}

export async function loadPreapprovedTools(
  appId: string,
  basePath: string,
): Promise<void> {
  const tools = await getPreapprovedByPath(basePath)
  for (const t of tools) {
    preapprovedTools.add(`${appId}::${t}`)
  }
}

export function updatePreapprovedTools(appId: string, tools: string[]): void {
  const appPrefix = `${appId}::`
  for (const name of [...preapprovedTools]) {
    if (name.startsWith(appPrefix)) preapprovedTools.delete(name)
  }
  for (const t of tools) {
    preapprovedTools.add(`${appPrefix}${t}`)
  }
}

/**
 * Args-aware preapproval for harness permission layers.
 *
 * - Legacy: `mcp__superone__<appId>__<tool>` matches preapprove by appId + tool
 * - Fixed: `mcp__superone__miniapp_call` checks input.appId + input.tool
 * - `miniapp_list` is always allow (via policy), not preapproved
 *
 * Pass tool call `input` whenever available so miniapp_call can resolve the real tool.
 */
export function isToolPreapproved(
  toolName: string,
  input: Record<string, unknown> = {},
): boolean {
  if (!toolName.startsWith(MCP_SUPERONE_TOOL_PREFIX)) return false
  return shouldAutoAllowMiniappTool(toolName, input)
}

export function unregisterAppTools(sessionId: string, appId: string): void {
  const key = makeAppKey(sessionId, appId)
  appToolDefs.delete(key)

  const appPrefix = `${appId}::`

  let stillOpen = false
  for (const e of appToolDefs.values()) {
    if (e.appId === appId) {
      stillOpen = true
      break
    }
  }
  if (!stillOpen) {
    for (const name of [...preapprovedTools]) {
      if (name.startsWith(appPrefix)) preapprovedTools.delete(name)
    }
  }

  log.info('[superone-mcp] unauthorized mini-app sessionId=%s appId=%s', sessionId, appId)
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

export function isSessionAuthorizedForApp(sessionId: string, projectDir: string, appId: string): boolean {
  const entry = appToolDefs.get(makeAppKey(sessionId, appId))
  return !!entry && entry.projectDir === projectDir
}

export function clearSessionPendingCalls(sessionId: string): void {
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

/** Execute a tool in the app's Node MiniApp Host, optionally after UI interception. */
export async function executeStandaloneTool(
  sessionId: string,
  appId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const key = makeAppKey(sessionId, appId)
  const defsEntry = appToolDefs.get(key)
  if (!defsEntry) {
    throw new Error(`App "${appId}" is not authorized in session "${sessionId}". This tool is no longer available.`)
  }
  const projectDir = defsEntry.projectDir
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
      const timeoutMs = intercept.timeoutMs ?? TOOL_INTERCEPT_TIMEOUT_MS
      const userInput = await openInterceptRenderer({
        callId,
        appId,
        projectDir,
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

  return executeInMiniAppHost(projectDir, appId, toolName, finalInput)
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
      const timeoutMs = intercept.timeoutMs ?? TOOL_INTERCEPT_TIMEOUT_MS
      const userInput = await openInterceptRenderer({
        callId,
        appId,
        projectDir,
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

  return executeInMiniAppHost(projectDir, appId, toolName, finalInput)
}

/**
 * Single entry point for executing a mini-app tool, shared by every harness.
 * Tool computation never depends on a mounted WebView.
 */
export async function dispatchAppToolCall(
  sessionId: string,
  projectDir: string,
  appId: string,
  toolName: string,
  isStandalone: boolean,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (isStandalone) {
    trace('miniapp.standalone', 'tool-dispatch', { appId, toolName, sessionId })
    const result = await executeStandaloneTool(sessionId, appId, toolName, args)
    trace('miniapp.standalone', 'tool-execute-done', { appId, toolName })
    return result
  }
  trace('miniapp.host', 'tool-execute-start', { appId, toolName })
  const result = await executeAppTool(sessionId, appId, toolName, args)
  trace('miniapp.host', 'tool-execute-done', { appId, toolName })
  return result
}

export function getAppToolDefs(): Map<string, AppToolEntry> {
  return appToolDefs
}
