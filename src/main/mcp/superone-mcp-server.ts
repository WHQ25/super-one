import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z, type ZodTypeAny } from 'zod'
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import log from '../logger'
import type { MiniAppToolDefinition, MiniAppToolCallRequest } from '../../shared/miniapp-types'
import { AgentIpcChannels } from '../../shared/agent-types'
import { createMiniApp, readManifest, cacheAppBasePath, discoverProjectApps, detectStandaloneApp, getProjectAppsDir } from '../miniapp/miniapp-service'
import { packApp } from '../miniapp/miniapp-packager'
import overviewMd from './guides/overview.md?raw'
import manifestMd from './guides/manifest.md?raw'
import apiMd from './guides/api.md?raw'
import packagingMd from './guides/packaging.md?raw'
import iconMd from './guides/icon.md?raw'

const MINIAPP_GUIDES: Record<string, string> = {
  overview: overviewMd,
  manifest: manifestMd,
  api: apiMd,
  packaging: packagingMd,
  icon: iconMd,
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
const appToolDefs = new Map<string, MiniAppToolDefinition[]>()
const appReadyGates = new Map<string, GateEntry>()

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
            'Which guide topic to read: overview (architecture, setup, testing), manifest (format, fields, types), api (bridge APIs, patterns), packaging (distribution), icon (visual assets)'
          ),
        },
        async ({ topic }) => ({
          content: [{ type: 'text' as const, text: MINIAPP_GUIDES[topic] }],
        }),
      ),
      tool(
        'list_apps',
        'List all installed mini-apps available on the canvas. Returns app IDs and names.',
        { verbose: z.boolean().optional().describe('Include full manifest details') },
        async () => {
          const apps = Array.from(registeredTools.keys()).map((name) => {
            const [appId] = name.split('__')
            return appId
          })
          const uniqueApps = [...new Set(apps)]
          return { content: [{ type: 'text' as const, text: JSON.stringify(uniqueApps) }] }
        },
      ),
      tool(
        'setup_mini_app_dev',
        `Initialize a mini-app development environment. Creates a scaffold with manifest.json, HTML/source files, and tool handler boilerplate.

All fields except name and projectDir are optional — omit any that aren't needed.`,
        {
          name: z.string().describe('Display name for the mini-app'),
          projectDir: z.string().describe('Absolute path to the project directory'),
          mode: z.enum(['project', 'standalone']).optional().describe('project (default): mini-app for the current project, placed in .superone/apps/<appId>/. standalone: the project IS the mini-app.'),
          template: z.enum(['vanilla', 'react']).optional().describe('vanilla (default): plain HTML, no build needed. react: React + TypeScript + Tailwind, requires build step.'),
          additionalDirs: z.array(z.string()).optional().describe('Additional directory names to create at the project root'),
          type: z.enum(['sidebar', 'panel', 'fullscreen']).optional().describe('Where the app appears: panel (resizable, default), sidebar (narrow left panel), fullscreen (full canvas)'),
          description: z.string().optional().describe('Short description of what the app does'),
          permissions: z.object({
            fs: z.array(z.object({
              scope: z.enum(['project', 'user', 'app']),
              path: z.string().optional().describe('Relative path within the scope (required for project/user)'),
              access: z.enum(['read', 'readwrite']).optional().describe('Access level (required for project/user)'),
              reason: z.string().describe('Why this permission is needed'),
            })).optional(),
            network: z.array(z.object({
              domain: z.string().describe('Whitelisted domain (e.g. "api.github.com")'),
              reason: z.string().describe('Why this domain is needed'),
            })).optional(),
          }).optional().describe('Permissions the app needs'),
          tools: z.array(z.object({
            name: z.string().describe('Tool name (lowercase, underscores only, e.g. "render_chart")'),
            description: z.string().describe('What this tool does — the agent reads this to decide when to use it'),
            inputSchema: z.object({
              type: z.literal('object'),
              properties: z.record(z.string(), z.object({
                type: z.string(),
                description: z.string().optional(),
              })).optional(),
              required: z.array(z.string()).optional(),
            }).describe('JSON Schema for the tool input'),
          })).optional().describe('MCP tools the agent can call on this app'),
        },
        async ({ name: appName, projectDir, mode, template, additionalDirs, type, description, permissions, tools }) => {
          const result = await createMiniApp({
            name: appName,
            projectDir,
            mode,
            template,
            additionalDirs,
            type,
            description,
            permissions,
            tools,
          })

          if (!result.buildRequired) {
            cacheAppBasePath(result.entry.id, result.entry.basePath)
            notifyDevAppReady(projectDir)
          }

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
    ],
  })
  mcpServer = config.instance as unknown as McpServer

  registeredTools.clear()
  for (const [appId, tools] of appToolDefs) {
    registerToolsOnServer(appId, tools)
  }

  return config
}

function registerToolsOnServer(appId: string, tools: MiniAppToolDefinition[]): void {
  for (const t of tools) {
    const namespacedName = `${appId}__${t.name}`

    if (registeredTools.has(namespacedName)) continue

    const zodShape = jsonSchemaToZodShape(t.inputSchema)
    const registered = mcpServer!.registerTool(
      namespacedName,
      {
        description: t.description,
        inputSchema: zodShape,
      },
      async (args: Record<string, unknown>) => {
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

export function registerAppTools(appId: string, tools: MiniAppToolDefinition[]): void {
  appToolDefs.set(appId, tools)

  if (!mcpServer) {
    log.info('[superone-mcp] no active session; tools cached for %s', appId)
    return
  }

  registerToolsOnServer(appId, tools)
  mcpServer.sendToolListChanged()
}

export function unregisterAppTools(appId: string): void {
  appToolDefs.delete(appId)
  const prefix = `${appId}__`
  for (const [name, tool] of registeredTools) {
    if (name.startsWith(prefix)) {
      tool.remove()
      registeredTools.delete(name)
      log.info('[superone-mcp] unregistered tool: %s', name)
    }
  }
  appReadyGates.delete(appId)
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
