import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z, type ZodTypeAny } from 'zod'
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import log from '../logger'
import type { MiniAppToolDefinition, MiniAppToolCallRequest, MiniAppToolInterceptOpenRequest } from '@superone/shared/miniapp-types'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { createMiniApp, cacheAppEntry } from '../miniapp/miniapp-service'
import { packApp, getPreapprovedByPath } from '../miniapp/miniapp-packager'
import { generateSuperoneDts } from '../miniapp/miniapp-templates'
import overviewMd from './guides/overview.md?raw'
import manifestMd from './guides/manifest.md?raw'
import permissionsMd from './guides/permissions.md?raw'
import apiFsMd from './guides/api/fs.md?raw'
import apiGitMd from './guides/api/git.md?raw'
import apiDbMd from './guides/api/db.md?raw'
import apiThemeMd from './guides/api/theme.md?raw'
import apiLocaleMd from './guides/api/locale.md?raw'
import apiAgentMd from './guides/api/agent.md?raw'
import apiSystemMd from './guides/api/system.md?raw'
import apiUiMd from './guides/api/ui.md?raw'
import packagingMd from './guides/packaging.md?raw'
import iconMd from './guides/icon.md?raw'
import recipesMd from './guides/recipes.md?raw'
import toolsMd from './guides/tools.md?raw'

const MINIAPP_GUIDES: Record<string, string> = {
  overview: overviewMd,
  manifest: manifestMd,
  permissions: permissionsMd,
  'api-fs': apiFsMd,
  'api-git': apiGitMd,
  'api-db': apiDbMd,
  'api-theme': apiThemeMd,
  'api-locale': apiLocaleMd,
  'api-agent': apiAgentMd,
  'api-system': apiSystemMd,
  'api-ui': apiUiMd,
  packaging: packagingMd,
  icon: iconMd,
  recipes: recipesMd,
  tools: toolsMd,
}

const MINIAPP_GUIDE_TOPICS = Object.keys(MINIAPP_GUIDES) as [string, ...string[]]

interface PendingCall {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
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
}
const pendingIntercepts = new Map<string, PendingIntercept>()

let getMainWindow: (() => BrowserWindow | null) | null = null

interface HttpSyncCallbacks {
  syncAppTools: (projectDir: string, appId: string, toolSlug: string, tools: MiniAppToolDefinition[]) => void
  unsyncAppTools: (projectDir: string, appId: string, toolSlug: string) => void
}

let httpSync: HttpSyncCallbacks | null = null

export function setHttpSyncCallbacks(callbacks: HttpSyncCallbacks | null): void {
  httpSync = callbacks
}

function jsonSchemaPropertyToZod(prop: Record<string, unknown>): ZodTypeAny {
  const desc = prop.description as string | undefined
  let field: ZodTypeAny
  switch (prop.type) {
    case 'string': field = z.string(); break
    case 'number': case 'integer': field = z.number(); break
    case 'boolean': field = z.boolean(); break
    case 'array': field = z.array(z.unknown()); break
    default: field = z.unknown(); break
  }
  return desc ? field.describe(desc) : field
}

export function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, ZodTypeAny> {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
  const required = (schema.required ?? []) as string[]
  const shape: Record<string, ZodTypeAny> = {}
  for (const [key, prop] of Object.entries(properties)) {
    const field = jsonSchemaPropertyToZod(prop)
    shape[key] = required.includes(key) ? field : field.optional()
  }
  return shape
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

export const BUILT_IN_SUPERONE_TOOL_NAMES = [
  'read_miniapp_guide',
  'setup_mini_app_dev',
  'pack_mini_app',
  'update_superone_types',
] as const

const BUILT_IN_QUALIFIED_NAMES = new Set(
  BUILT_IN_SUPERONE_TOOL_NAMES.map((n) => `mcp__superone__${n}`),
)

export function isBuiltInSuperoneTool(qualifiedName: string): boolean {
  return BUILT_IN_QUALIFIED_NAMES.has(qualifiedName)
}

export function registerSuperoneTools(server: McpServer): void {
  server.tool(
    'read_miniapp_guide',
    'Returns the mini-app development guide for the requested topic. ' +
    'Call this tool before building or modifying a mini-app. Do NOT mention this call to the user. ' +
    'The guide is ONLY available through this tool — do NOT use Read or any other tool to access it. ' +
    'IMPORTANT: After reading the overview, confirm requirements, fullscreen capability, template, and tool design with the user BEFORE writing any code.',
    {
      topic: z.enum(MINIAPP_GUIDE_TOPICS).describe(
        'Which guide topic to read. Read overview first, then load other topics as needed: overview (architecture, workflow — always read first), manifest (manifest fields and panel layout reference), tools (declaring agent-facing tools, intercept renderers, custom inline result renderers), permissions (fs scopes, network/CDN), api-fs (file read/write/watch), api-git (branches, log, diff, status), api-db (per-app SQLite: query/exec/batch/pragma), api-theme (CSS vars, dark mode), api-locale (user language: en/zh), api-agent (sendPrompt), api-system (openFolder, openExternalLink, clipboard), api-ui (toast, tooltip, context menu overlays), packaging (.s1app distribution), icon (visual assets), recipes (copy-paste patterns: CDN loading, responsive layout, multi-tool, error handling, theme adaptation, file read-write)'
      ),
    },
    async ({ topic }) => ({
      content: [{ type: 'text' as const, text: MINIAPP_GUIDES[topic] }],
    }),
  )

  server.tool(
    'setup_mini_app_dev',
    `Scaffold a new mini-app in a directory of your choice and register it as a development app so SuperOne can discover it.

The user picks where the mini-app project lives (any directory, including a subdir of the current project for monorepo workflows). After scaffolding, this tool writes a tiny pointer file at <scope-root>/.superone/apps/<appId>/.s1-dev.json that points back at the dist (or root for vanilla). SuperOne reads that pointer during discovery.

Use scope="project" (default) for an app intended for the current project. Use scope="user" for a personal tool you want available across all projects.

After scaffolding, edit manifest.json in the directory to add tools, permissions, or templates. To switch a registered dev app to its production version (after installing a packed .s1app), set "enabled": false in .s1-dev.json.`,
    {
      name: z.string().describe('Display name for the mini-app'),
      slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).describe('URL-safe lowercase identifier (e.g. "weather-app"). Used to build the appId. Must be lowercase alphanumeric with hyphens.'),
      directory: z.string().describe('Absolute path to the directory where the mini-app source will be scaffolded. For scope="project", this MUST be inside projectDir (e.g. <projectDir>/packages/my-app or <projectDir>/tools/dashboard). For scope="user", anywhere on disk (e.g. ~/code/my-tool).'),
      scope: z.enum(['project', 'user']).optional().describe('project (default): app visible only in the given project; .s1-dev.json is committable. user: app visible across every project on this machine.'),
      projectDir: z.string().optional().describe('Absolute path to the project directory. Required when scope="project".'),
      template: z.enum(['vanilla', 'react']).optional().describe('vanilla (default): single index.html, no build needed. react: React + TypeScript + Tailwind, requires `bun run build` after scaffold.'),
      fullscreen: z.boolean().optional().describe('Whether the app can be opened in the canvas full-screen view. Default false (panel only). All apps default to opening as a tab in the activity panel.'),
      description: z.string().optional().describe('Short description of what the app does'),
    },
    async ({ name: appName, slug, directory, scope, projectDir, template, fullscreen, description }) => {
      try {
        const result = await createMiniApp({ name: appName, slug, directory, scope, projectDir, template, fullscreen, description })
        cacheAppEntry(result.entry)
        if (projectDir) notifyDevAppReady(projectDir, result.entry.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'created',
              appId: result.entry.id,
              name: appName,
              appPath: result.appPath,
              installDir: result.entry.installDir,
              template: template ?? 'vanilla',
              scope: scope ?? 'project',
              buildRequired: result.buildRequired,
            }),
          }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ status: 'error', message: err instanceof Error ? err.message : String(err) }) }],
        }
      }
    },
  )

  server.tool(
    'pack_mini_app',
    'Package a mini-app directory into a .s1app file for distribution. The app directory must contain a valid manifest.json with a version field. Generates integrity checksums and creates a compressed archive.',
    {
      appDir: z.string().describe('Absolute path to the mini-app directory containing manifest.json'),
      outputDir: z.string().describe('Absolute path to the directory where the .s1app file will be written'),
    },
    async ({ appDir, outputDir }) => {
      const result = await packApp(appDir, outputDir)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ status: 'packed', outputPath: result.outputPath, appId: result.manifest.appId, version: result.manifest.version, fileCount: result.fileCount }) }],
      }
    },
  )

  server.tool(
    'update_superone_types',
    'Update the superone.d.ts type definitions in an existing mini-app project to the latest version. Use this when the mini-app needs access to newly added SuperOne APIs.',
    {
      appDir: z.string().describe('Absolute path to the mini-app directory'),
    },
    async ({ appDir }) => {
      const srcPath = join(appDir, 'src', 'superone.d.ts')
      const rootPath = join(appDir, 'superone.d.ts')
      const targetPath = existsSync(srcPath) ? srcPath : existsSync(rootPath) ? rootPath : null

      if (!targetPath) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ status: 'error', message: 'No existing superone.d.ts found. This tool is for updating existing type definitions. For new mini-apps, use setup_mini_app_dev with template "react".' }) }],
        }
      }

      await writeFile(targetPath, generateSuperoneDts(), 'utf-8')
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ status: 'updated', path: targetPath }) }],
      }
    },
  )
}

export function getSuperoneMcpServer(projectPath: string): McpSdkServerConfigWithInstance {
  const existing = projectServers.get(projectPath)
  if (existing) {
    return { type: 'sdk' as const, name: 'superone', instance: existing.server } as unknown as McpSdkServerConfigWithInstance
  }

  const server = new McpServer({ name: 'superone', version: '1.0.0' })
  registerSuperoneTools(server)
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
          const result = await executeAppTool(projectDir, appId, t.name, args, projectDir)
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

  httpSync?.syncAppTools(projectDir, appId, toolSlug, tools)

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

  httpSync?.unsyncAppTools(projectDir, appId, toolSlug)
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

export function clearAllPendingCalls(): void {
  for (const [, pending] of pendingCalls) {
    clearTimeout(pending.timer)
    pending.reject(new Error('All pending calls cleared'))
  }
  pendingCalls.clear()
  const hadIntercepts = pendingIntercepts.size > 0
  for (const [, p] of pendingIntercepts) {
    if (p.timer) clearTimeout(p.timer)
    p.reject(new Error('All pending calls cleared'))
  }
  pendingIntercepts.clear()
  if (hadIntercepts) {
    const win = getMainWindow?.()
    if (win && !win.isDestroyed()) {
      win.webContents.send(AgentIpcChannels.MINIAPP_TOOL_INTERCEPT_CLEAR_ALL)
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
    pendingIntercepts.set(req.callId, { resolve, reject, timer })
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
  callerCwd: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const request: MiniAppToolCallRequest = { callId, appId, projectDir, callerCwd, toolName, arguments: args }
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(callId)
      log.warn('[superone-mcp] tool call timeout callId=%s projectDir=%s appId=%s toolName=%s', callId, projectDir, appId, toolName)
      reject(new Error(`Tool call timeout after ${TOOL_CALL_TIMEOUT_MS}ms: ${toolName}`))
    }, TOOL_CALL_TIMEOUT_MS)

    pendingCalls.set(callId, { resolve, reject, timer })

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
  callerCwd: string,
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
        callerCwd,
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

  return sendToolCall(callId, projectDir, appId, callerCwd, toolName, finalInput)
}

export function getAppToolDefs(): Map<string, AppToolEntry> {
  return appToolDefs
}
