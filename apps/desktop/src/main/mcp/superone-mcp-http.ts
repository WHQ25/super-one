import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer, type Server } from 'http'
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import log from '../logger'
import type { MiniAppToolDefinition, MiniAppManifest } from '@superone/shared/miniapp-types'
import {
  setHttpSyncCallbacks,
  registerSuperoneTools,
  executeAppTool,
  jsonSchemaToZodShape,
  getAppToolDefs,
  getInChatAppDefs,
  type InChatAppDef,
} from './superone-mcp-server'
import { registerWidgetTools } from '../generative-ui/mcp-server'
import { writeCodexMcpConfig, removeCodexMcpConfig } from './codex-mcp-config'

interface HttpSession {
  transport: StreamableHTTPServerTransport
  server: McpServer
  registeredTools: Map<string, RegisteredTool>
  registeredInChatTools: Map<string, RegisteredTool>
  inChatToolOwners: Map<string, string>
}

let httpServer: Server | null = null
let port = 0
const sessions = new Map<string, HttpSession>()

function registerDynamicToolOnSession(
  session: HttpSession,
  appId: string,
  toolSlug: string,
  t: MiniAppToolDefinition,
): void {
  const namespacedName = `${toolSlug}__${t.name}`
  if (session.registeredTools.has(namespacedName)) return

  const zodShape = jsonSchemaToZodShape(t.inputSchema)
  const registered = session.server.registerTool(
    namespacedName,
    { description: t.description, inputSchema: zodShape },
    async (args: Record<string, unknown>) => {
      try {
        const result = await executeAppTool(appId, t.name, args)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `[Error] ${err instanceof Error ? err.message : String(err)}` }] }
      }
    },
  )
  session.registeredTools.set(namespacedName, registered)
}

function registerInChatToolOnSession(session: HttpSession, def: InChatAppDef): void {
  const namespacedName = `inchat__${def.inChatToolName}`
  if (session.registeredInChatTools.has(namespacedName)) return

  const existing = session.inChatToolOwners.get(def.inChatToolName)
  if (existing && existing !== def.appId) {
    log.warn('[mcp-http] in-chat toolName conflict: %s (owned by %s, skipping %s)', def.inChatToolName, existing, def.appId)
    return
  }

  const zodShape = jsonSchemaToZodShape(def.inputSchema)
  const registered = session.server.registerTool(
    namespacedName,
    { description: def.description, inputSchema: zodShape },
    async (args: Record<string, unknown>) => ({
      content: [{ type: 'text' as const, text: JSON.stringify({ __inchat: true, appId: def.appId, data: args }) }],
    }),
  )
  session.registeredInChatTools.set(namespacedName, registered)
  session.inChatToolOwners.set(def.inChatToolName, def.appId)
}

function createSessionServer(): McpServer {
  const server = new McpServer({ name: 'superone', version: '1.0.0' })
  registerSuperoneTools(server)
  registerWidgetTools(server, { skipWidgetGate: true })
  return server
}

function populateSessionDynamicTools(session: HttpSession): void {
  for (const [appId, { toolSlug, tools }] of getAppToolDefs()) {
    for (const t of tools) {
      registerDynamicToolOnSession(session, appId, toolSlug, t)
    }
  }
  for (const [, def] of getInChatAppDefs()) {
    registerInChatToolOnSession(session, def)
  }
}

export async function startMcpHttpServer(_windowGetter: () => BrowserWindow | null): Promise<void> {
  if (httpServer) return

  setHttpSyncCallbacks({
    syncAppTools,
    unsyncAppTools,
    syncInChatApp,
    unsyncInChatApp,
  })

  return new Promise((resolve, reject) => {
    httpServer = createServer(async (req, res) => {
      if (!req.url?.startsWith('/mcp')) {
        res.writeHead(404).end()
        return
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined

      try {
        if (req.method === 'POST') {
          if (sessionId && sessions.has(sessionId)) {
            await sessions.get(sessionId)!.transport.handleRequest(req, res)
          } else {
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
            const server = createSessionServer()
            await server.connect(transport)

            const session: HttpSession = {
              transport,
              server,
              registeredTools: new Map(),
              registeredInChatTools: new Map(),
              inChatToolOwners: new Map(),
            }
            populateSessionDynamicTools(session)

            let closed = false
            transport.onclose = () => {
              closed = true
              const sid = transport.sessionId
              if (sid) {
                sessions.delete(sid)
                log.info('[mcp-http] session closed: %s', sid)
              }
            }

            await transport.handleRequest(req, res)

            const sid = transport.sessionId
            if (sid && !closed) {
              sessions.set(sid, session)
              log.info('[mcp-http] new session: %s', sid)
            }
          }
        } else if (req.method === 'GET') {
          if (sessionId && sessions.has(sessionId)) {
            await sessions.get(sessionId)!.transport.handleRequest(req, res)
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing or invalid session ID' }))
          }
        } else if (req.method === 'DELETE') {
          if (sessionId && sessions.has(sessionId)) {
            const session = sessions.get(sessionId)!
            await session.transport.handleRequest(req, res)
            sessions.delete(sessionId)
          } else {
            res.writeHead(404).end()
          }
        } else {
          res.writeHead(405).end()
        }
      } catch (err) {
        log.error('[mcp-http] request error:', err)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      }
    })

    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer!.address()
      port = typeof addr === 'object' ? addr!.port : 0
      log.info('[mcp-http] listening on 127.0.0.1:%d', port)

      writeCodexMcpConfig(port).catch((err) =>
        log.error('[mcp-http] failed to write codex config:', err)
      )

      resolve()
    })

    httpServer.on('error', reject)
  })
}

export function stopMcpHttpServer(): void {
  setHttpSyncCallbacks(null)

  for (const [, session] of sessions) {
    session.transport.close().catch(() => {})
  }
  sessions.clear()

  httpServer?.close()
  httpServer = null
  port = 0

  removeCodexMcpConfig().catch((err) =>
    log.error('[mcp-http] failed to remove codex config:', err)
  )
}

export function getMcpHttpPort(): number {
  return port
}

function syncAppTools(appId: string, toolSlug: string, tools: MiniAppToolDefinition[]): void {
  for (const [, session] of sessions) {
    for (const t of tools) {
      registerDynamicToolOnSession(session, appId, toolSlug, t)
    }
    session.server.sendToolListChanged()
  }
}

function unsyncAppTools(_appId: string, toolSlug: string): void {
  const prefix = `${toolSlug}__`
  for (const [, session] of sessions) {
    for (const [name, tool] of session.registeredTools) {
      if (name.startsWith(prefix)) {
        tool.remove()
        session.registeredTools.delete(name)
      }
    }
    session.server.sendToolListChanged()
  }
}

function syncInChatApp(manifest: MiniAppManifest): void {
  if (manifest.type !== 'in-chat' || !manifest.inChatToolName || !manifest.inputSchema) return
  const def: InChatAppDef = {
    appId: manifest.appId,
    inChatToolName: manifest.inChatToolName,
    description: manifest.inChatToolDescription || manifest.description || manifest.name,
    inputSchema: manifest.inputSchema,
  }
  for (const [, session] of sessions) {
    registerInChatToolOnSession(session, def)
    session.server.sendToolListChanged()
  }
}

function unsyncInChatApp(appId: string): void {
  for (const [, session] of sessions) {
    for (const [toolName, owner] of session.inChatToolOwners) {
      if (owner !== appId) continue
      const namespacedName = `inchat__${toolName}`
      const tool = session.registeredInChatTools.get(namespacedName)
      if (tool) {
        tool.remove()
        session.registeredInChatTools.delete(namespacedName)
      }
      session.inChatToolOwners.delete(toolName)
    }
    session.server.sendToolListChanged()
  }
}
