import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer, type Server } from 'http'
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import log from '../logger'
import type { MiniAppToolDefinition } from '@superone/shared/miniapp-types'
import {
  setHttpSyncCallbacks,
  registerSuperoneTools,
  executeAppTool,
  jsonSchemaToZodShape,
  getAppToolDefs,
} from './superone-mcp-server'
import { registerWidgetTools } from '../generative-ui/mcp-server'
import { writeCodexMcpConfig, removeCodexMcpConfig } from './codex-mcp-config'

// NOTE: HTTP MCP serves external agents (codex CLI) that can't share the in-process SDK MCP server.
// Mini-app tools are routed per-(projectDir, appId) — the HTTP client MUST declare its projectDir
// via the `?projectDir=` query string when initializing a session, otherwise no mini-app tools
// will be exposed (built-in superone + widget tools remain available).
//
// TODO: replace this HTTP transport with a per-codex-spawn stdio bridge so projectDir can be passed
// via env at spawn time instead of relying on the codex client to construct the URL query.

interface HttpSession {
  transport: StreamableHTTPServerTransport
  server: McpServer
  registeredTools: Map<string, RegisteredTool>
  projectDir: string | null
}

let httpServer: Server | null = null
let port = 0
const sessions = new Map<string, HttpSession>()

function registerDynamicToolOnSession(
  session: HttpSession,
  projectDir: string,
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
        const result = await executeAppTool(projectDir, appId, t.name, args, projectDir)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `[Error] ${err instanceof Error ? err.message : String(err)}` }] }
      }
    },
  )
  session.registeredTools.set(namespacedName, registered)
}

function createSessionServer(): McpServer {
  const server = new McpServer({ name: 'superone', version: '1.0.0' })
  registerSuperoneTools(server)
  registerWidgetTools(server, { skipWidgetGate: true })
  return server
}

function populateSessionDynamicTools(session: HttpSession): void {
  if (!session.projectDir) return
  for (const entry of getAppToolDefs().values()) {
    if (entry.projectDir !== session.projectDir) continue
    for (const t of entry.tools) {
      registerDynamicToolOnSession(session, entry.projectDir, entry.appId, entry.toolSlug, t)
    }
  }
}

function parseProjectDirFromUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url, 'http://localhost')
    const pd = parsed.searchParams.get('projectDir')
    return pd && pd.length > 0 ? pd : null
  } catch {
    return null
  }
}

export async function startMcpHttpServer(_windowGetter: () => BrowserWindow | null): Promise<void> {
  if (httpServer) return

  setHttpSyncCallbacks({
    syncAppTools,
    unsyncAppTools,
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
            const projectDir = parseProjectDirFromUrl(req.url)
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
            const server = createSessionServer()
            await server.connect(transport)

            const session: HttpSession = {
              transport,
              server,
              registeredTools: new Map(),
              projectDir,
            }
            if (!projectDir) {
              log.warn('[mcp-http] new session has no projectDir — mini-app tools will not be exposed')
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
              log.info('[mcp-http] new session: %s projectDir=%s', sid, projectDir ?? 'none')
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

function syncAppTools(projectDir: string, appId: string, toolSlug: string, tools: MiniAppToolDefinition[]): void {
  for (const [, session] of sessions) {
    if (session.projectDir !== projectDir) continue
    for (const t of tools) {
      registerDynamicToolOnSession(session, projectDir, appId, toolSlug, t)
    }
    session.server.sendToolListChanged()
  }
}

function unsyncAppTools(projectDir: string, _appId: string, toolSlug: string): void {
  const prefix = `${toolSlug}__`
  for (const [, session] of sessions) {
    if (session.projectDir !== projectDir) continue
    for (const [name, tool] of session.registeredTools) {
      if (name.startsWith(prefix)) {
        tool.remove()
        session.registeredTools.delete(name)
      }
    }
    session.server.sendToolListChanged()
  }
}
