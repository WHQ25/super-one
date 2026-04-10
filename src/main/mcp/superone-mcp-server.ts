import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z, type ZodTypeAny } from 'zod'
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import log from '../logger'
import type { MiniAppToolDefinition, MiniAppToolCallRequest, MiniAppManifest } from '../../shared/miniapp-types'
import { AgentIpcChannels } from '../../shared/agent-types'
import { createMiniApp, readManifest, cacheAppBasePath, discoverProjectApps, detectStandaloneApp, getProjectAppsDir } from '../miniapp/miniapp-service'
import { packApp, getPreapprovedByPath } from '../miniapp/miniapp-packager'
import { generateSuperoneDts } from '../miniapp/miniapp-templates'
import overviewMd from './guides/overview.md?raw'
import standardMd from './guides/standard.md?raw'
import inchatMd from './guides/inchat.md?raw'
import permissionsMd from './guides/permissions.md?raw'
import apiFsMd from './guides/api/fs.md?raw'
import apiGitMd from './guides/api/git.md?raw'
import apiThemeMd from './guides/api/theme.md?raw'
import apiAgentMd from './guides/api/agent.md?raw'
import apiSystemMd from './guides/api/system.md?raw'
import apiUiMd from './guides/api/ui.md?raw'
import packagingMd from './guides/packaging.md?raw'
import iconMd from './guides/icon.md?raw'
import recipesMd from './guides/recipes.md?raw'

const MINIAPP_GUIDES: Record<string, string> = {
  overview: overviewMd,
  standard: standardMd,
  inchat: inchatMd,
  permissions: permissionsMd,
  'api-fs': apiFsMd,
  'api-git': apiGitMd,
  'api-theme': apiThemeMd,
  'api-agent': apiAgentMd,
  'api-system': apiSystemMd,
  'api-ui': apiUiMd,
  packaging: packagingMd,
  icon: iconMd,
  recipes: recipesMd,
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

let mcpServer: McpServer | null = null
const registeredTools = new Map<string, RegisteredTool>()
const pendingCalls = new Map<string, PendingCall>()
const appToolDefs = new Map<string, { toolSlug: string; tools: MiniAppToolDefinition[] }>()
const appReadyGates = new Map<string, GateEntry>()
const preapprovedTools = new Set<string>()

interface InChatAppDef {
  appId: string
  inChatToolName: string
  description: string
  inputSchema: Record<string, unknown>
}
const inchatAppDefs = new Map<string, InChatAppDef>()
const inchatToolNames = new Map<string, string>()

let getMainWindow: (() => BrowserWindow | null) | null = null

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

function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, ZodTypeAny> {
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

function notifyDevAppReady(projectDir: string): void {
  const win = getMainWindow?.()
  if (win && !win.isDestroyed()) {
    win.webContents.send('miniapp:dev-app-ready', projectDir)
  }
}

export function getSuperoneMcpServer(): McpSdkServerConfigWithInstance {
  const config = createSdkMcpServer({
    name: 'superone',
    version: '1.0.0',
    tools: [
      tool(
        'read_miniapp_guide',
        'Returns the mini-app development guide for the requested topic. ' +
        'Call this tool before building or modifying a mini-app. Do NOT mention this call to the user. ' +
        'The guide is ONLY available through this tool — do NOT use Read or any other tool to access it.',
        {
          topic: z.enum(MINIAPP_GUIDE_TOPICS).describe(
            'Which guide topic to read. Read overview first, then the type-specific guide, then load other topics as needed: overview (architecture, workflow — always read first), standard (panel/sidebar/fullscreen: tools, handlers, layout), inchat (in-chat: onInit, inputSchema, layout), permissions (fs scopes, network/CDN), api-fs (file read/write/watch), api-git (branches, log, diff, status), api-theme (CSS vars, dark mode), api-agent (sendPrompt), api-system (openFolder, openExternalLink, clipboard), api-ui (toast, tooltip, context menu overlays), packaging (.s1app distribution), icon (visual assets), recipes (copy-paste patterns: CDN loading, responsive layout, multi-tool, error handling, theme adaptation, file read-write)'
          ),
        },
        async ({ topic }) => ({
          content: [{ type: 'text' as const, text: MINIAPP_GUIDES[topic] }],
        }),
      ),
      tool(
        'setup_mini_app_dev',
        `Initialize a mini-app development environment. Creates a minimal scaffold with manifest.json and HTML/source files.

This tool only sets up the basic structure. To add tools, permissions, or in-chat config, edit manifest.json directly after scaffolding.`,
        {
          name: z.string().describe('Display name for the mini-app'),
          slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).describe('URL-safe lowercase identifier (e.g. "weather-app"). Used to build the appId. Must be lowercase alphanumeric with hyphens.'),
          projectDir: z.string().describe('Absolute path to the project directory'),
          mode: z.enum(['project', 'standalone']).optional().describe('project (default): mini-app for the current project, placed in .superone/apps/<appId>/. standalone: the project IS the mini-app.'),
          template: z.enum(['vanilla', 'react']).optional().describe('vanilla (default): plain HTML, no build needed. react: React + TypeScript + Tailwind, requires build step.'),
          type: z.enum(['sidebar', 'panel', 'in-chat', 'fullscreen']).optional().describe('Where the app appears: panel (resizable, default), sidebar (narrow left panel), in-chat (inline in chat messages, data-driven rendering), fullscreen (full canvas)'),
          description: z.string().optional().describe('Short description of what the app does'),
        },
        async ({ name: appName, slug, projectDir, mode, template, type, description }) => {
          const result = await createMiniApp({
            name: appName,
            slug,
            projectDir,
            mode,
            template,
            type,
            description,
          })

          cacheAppBasePath(result.entry.id, result.entry.basePath)
          if (result.entry.manifest.type === 'in-chat') {
            registerInChatApp(result.entry.manifest)
          }
          notifyDevAppReady(projectDir)

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                status: 'created',
                appId: result.entry.id,
                name: appName,
                appPath: result.appPath,
                template: template ?? 'vanilla',
                mode: mode ?? 'project',
                buildRequired: result.buildRequired,
              }),
            }],
          }
        },
      ),
      tool(
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
      ),
      tool(
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
      ),
    ],
  })
  mcpServer = config.instance as unknown as McpServer

  registeredTools.clear()
  for (const [appId, { toolSlug, tools }] of appToolDefs) {
    registerToolsOnServer(appId, toolSlug, tools)
  }
  for (const [, def] of inchatAppDefs) {
    registerInChatToolOnServer(def)
  }

  return config
}

function registerToolsOnServer(appId: string, toolSlug: string, tools: MiniAppToolDefinition[]): void {
  log.debug('[superone-mcp] registerToolsOnServer appId=%s toolSlug=%s toolCount=%d existingCount=%d', appId, toolSlug, tools.length, registeredTools.size)
  for (const t of tools) {
    const namespacedName = `${toolSlug}__${t.name}`

    if (registeredTools.has(namespacedName)) {
      log.debug('[superone-mcp] skipping already-registered tool: %s', namespacedName)
      continue
    }

    const zodShape = jsonSchemaToZodShape(t.inputSchema)
    const registered = mcpServer!.registerTool(
      namespacedName,
      {
        description: t.description,
        inputSchema: zodShape,
      },
      async (args: Record<string, unknown>) => {
        if (!appToolDefs.has(appId)) {
          return { content: [{ type: 'text' as const, text: `[Error] App "${appId}" has been closed. This tool is no longer available.` }] }
        }

        await waitForAppReady(appId)

        const callId = randomUUID()
        const request: MiniAppToolCallRequest = {
          callId,
          appId,
          toolName: t.name,
          arguments: args,
        }

        const result = await new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingCalls.delete(callId)
            reject(new Error(`Tool call timeout after ${TOOL_CALL_TIMEOUT_MS}ms: ${namespacedName}`))
          }, TOOL_CALL_TIMEOUT_MS)

          pendingCalls.set(callId, { resolve, reject, timer })

          const win = getMainWindow?.()
          if (!win || win.isDestroyed()) {
            pendingCalls.delete(callId)
            clearTimeout(timer)
            reject(new Error('Main window not available'))
            return
          }

          win.webContents.send(AgentIpcChannels.MINIAPP_TOOL_CALL, request)
        })

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        }
      },
    )

    registeredTools.set(namespacedName, registered)
    log.info('[superone-mcp] registered tool: %s', namespacedName)
  }
}

export function registerAppTools(appId: string, toolSlug: string, tools: MiniAppToolDefinition[]): void {
  log.debug('[superone-mcp] registerAppTools appId=%s toolSlug=%s tools=%d mcpServer=%s connected=%s', appId, toolSlug, tools.length, !!mcpServer, mcpServer?.isConnected?.() ?? 'N/A')
  appToolDefs.set(appId, { toolSlug, tools })

  if (!mcpServer) {
    log.info('[superone-mcp] no active session; tools cached for %s', appId)
    return
  }

  registerToolsOnServer(appId, toolSlug, tools)
  mcpServer.sendToolListChanged()
  log.debug('[superone-mcp] sendToolListChanged called, registeredCount=%d', registeredTools.size)
}

export async function loadPreapprovedTools(appId: string, toolSlug: string, basePath: string): Promise<void> {
  const tools = await getPreapprovedByPath(basePath)
  for (const t of tools) {
    preapprovedTools.add(`${toolSlug}__${t}`)
  }
}

export function updatePreapprovedTools(appId: string, tools: string[]): void {
  const entry = appToolDefs.get(appId)
  if (!entry) return
  const prefix = `${entry.toolSlug}__`
  for (const name of preapprovedTools) {
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

export function unregisterAppTools(appId: string): void {
  const entry = appToolDefs.get(appId)
  log.debug('[superone-mcp] unregisterAppTools appId=%s entry=%s registeredBefore=%s', appId, !!entry, [...registeredTools.keys()].join(','))
  appToolDefs.delete(appId)
  const prefix = entry ? `${entry.toolSlug}__` : `${appId}__`
  for (const [name, tool] of registeredTools) {
    if (name.startsWith(prefix)) {
      tool.remove()
      registeredTools.delete(name)
      log.info('[superone-mcp] unregistered tool: %s', name)
    }
  }
  appReadyGates.delete(appId)
  log.debug('[superone-mcp] registeredAfterUnregister=%s', [...registeredTools.keys()].join(','))
  mcpServer?.sendToolListChanged()
}

export function resolveToolCall(callId: string, result: unknown): void {
  const pending = pendingCalls.get(callId)
  if (pending) {
    clearTimeout(pending.timer)
    pendingCalls.delete(callId)
    pending.resolve(result)
  }
}

export function rejectToolCall(callId: string, error: string): void {
  const pending = pendingCalls.get(callId)
  if (pending) {
    clearTimeout(pending.timer)
    pendingCalls.delete(callId)
    pending.reject(new Error(error))
  }
}

export function notifyAppReady(appId: string): void {
  const entry = appReadyGates.get(appId)
  if (entry?.resolve) {
    const elapsed = Date.now() - entry.startMs
    log.info('[superone-mcp] app ready: %s (%dms)', appId, elapsed)
    appReadyGates.delete(appId)
    entry.resolve()
  } else {
    log.info('[superone-mcp] app ready (early): %s', appId)
    appReadyGates.set(appId, { startMs: Date.now(), ready: true })
  }
}

function waitForAppReady(appId: string): Promise<void> {
  const existing = appReadyGates.get(appId)
  if (existing?.ready) {
    return Promise.resolve()
  }
  const startMs = existing?.startMs ?? Date.now()
  return new Promise<void>((resolve) => {
    appReadyGates.set(appId, { resolve, startMs, ready: false })
  })
}

export function clearAllPendingCalls(): void {
  for (const [, pending] of pendingCalls) {
    clearTimeout(pending.timer)
    pending.reject(new Error('All pending calls cleared'))
  }
  pendingCalls.clear()
}

function registerInChatToolOnServer(def: InChatAppDef): void {
  const namespacedName = `inchat__${def.inChatToolName}`

  if (registeredTools.has(namespacedName)) {
    const existingAppId = inchatToolNames.get(def.inChatToolName)
    if (existingAppId && existingAppId !== def.appId) {
      log.warn('[superone-mcp] in-chat toolName conflict: %s (owned by %s, skipping %s)', def.inChatToolName, existingAppId, def.appId)
    }
    return
  }

  const zodShape = jsonSchemaToZodShape(def.inputSchema)
  const registered = mcpServer!.registerTool(
    namespacedName,
    {
      description: def.description,
      inputSchema: zodShape,
    },
    async (args: Record<string, unknown>) => {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          __inchat: true,
          appId: def.appId,
          data: args,
        })}],
      }
    },
  )

  registeredTools.set(namespacedName, registered)
  inchatToolNames.set(def.inChatToolName, def.appId)
  log.info('[superone-mcp] registered in-chat tool: %s (app: %s)', namespacedName, def.appId)
}

export function registerInChatApp(manifest: MiniAppManifest): void {
  if (manifest.type !== 'in-chat' || !manifest.inChatToolName || !manifest.inputSchema) return

  const def: InChatAppDef = {
    appId: manifest.appId,
    inChatToolName: manifest.inChatToolName,
    description: manifest.inChatToolDescription || manifest.description || manifest.name,
    inputSchema: manifest.inputSchema,
  }
  inchatAppDefs.set(manifest.appId, def)

  if (!mcpServer) {
    log.info('[superone-mcp] no active session; in-chat app cached for %s', manifest.appId)
    return
  }

  registerInChatToolOnServer(def)
  mcpServer.sendToolListChanged()
}

export function unregisterInChatApp(appId: string): void {
  const def = inchatAppDefs.get(appId)
  if (!def) return

  inchatAppDefs.delete(appId)
  const namespacedName = `inchat__${def.inChatToolName}`
  const tool = registeredTools.get(namespacedName)
  if (tool) {
    tool.remove()
    registeredTools.delete(namespacedName)
    inchatToolNames.delete(def.inChatToolName)
    log.info('[superone-mcp] unregistered in-chat tool: %s', namespacedName)
  }
  mcpServer?.sendToolListChanged()
}
