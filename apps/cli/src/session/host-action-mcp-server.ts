/**
 * Node Host Action MCP — HTTP transport adapter + harness config factory.
 *
 * Tool surface lives in `host-action-mcp-core.ts`. This module:
 * - binds loopback Streamable HTTP (Codex / ACP / OpenCode)
 * - builds per-session HTTP auth configs for those harnesses
 * - creates in-process Claude Agent SDK MCP instances (type: 'sdk')
 *
 * Mirrors the HTTP half of desktop `superone-mcp-stdio-ipc.ts`:
 * - bind 127.0.0.1 ephemeral port
 * - per-session HMAC bearer + X-SuperOne-Session-Id + Host validation
 * - StreamableHTTPServerTransport
 */

import { randomUUID } from 'node:crypto'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import {
  buildAcpSuperoneMcpServer,
  buildClaudeHttpMcpServers,
  buildCodexSuperoneMcpConfig,
  buildOpenCodeSuperoneMcpConfig,
  buildSuperoneMcpHttpConfig,
  isValidSuperoneMcpSessionToken,
  SUPERONE_MCP_SESSION_HEADER,
  type AcpSuperoneMcpServer,
  type CodexSuperoneMcpConfig,
  type OpenCodeSuperoneMcpConfig,
  type SuperoneMcpHttpConfig,
} from './host-action-mcp-auth'
import {
  createHostActionMcpServer,
  HOST_ACTION_MCP_NAME,
  type HostActionRequestFn,
} from './host-action-mcp-core'

const MAX_HTTP_BODY_BYTES = 1024 * 1024

export type { HostActionRequestFn }

export interface HostActionMcpServerOptions {
  requestHostAction: HostActionRequestFn
  /** Injectable for tests. */
  masterToken?: string
}

interface HttpMcpSession {
  superoneSessionId: string
  server: McpServer
  transport: StreamableHTTPServerTransport
  closing: boolean
}

export interface ClaudeSdkMcpHandle {
  mcpServers: Record<string, McpSdkServerConfigWithInstance>
  dispose(): Promise<void>
}

export interface HostActionMcpServerHandle {
  httpUrl: string
  masterToken: string
  getHttpConfig(sessionId: string): SuperoneMcpHttpConfig
  getCodexMcpConfig(sessionId: string): CodexSuperoneMcpConfig
  getOpenCodeMcpConfig(sessionId: string): OpenCodeSuperoneMcpConfig
  getAcpMcpServer(sessionId: string): AcpSuperoneMcpServer
  /**
   * Claude Agent SDK in-process MCP (type: 'sdk').
   * Caller must dispose after the turn so the McpServer is closed.
   */
  createClaudeSdkMcp(sessionId: string): ClaudeSdkMcpHandle
  /**
   * HTTP mcpServers map — used by tests and as a Claude fallback shape.
   * Prefer {@link createClaudeSdkMcp} for production Claude turns.
   */
  getClaudeHttpMcpServers(
    sessionId: string,
  ): Record<string, { type: 'http'; url: string; headers: Record<string, string> }>
  /** @deprecated Use createClaudeSdkMcp / getClaudeHttpMcpServers. */
  getClaudeMcpServers(
    sessionId: string,
  ): Record<string, { type: 'http'; url: string; headers: Record<string, string> }>
  stop(): Promise<void>
}

function writeHttpError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message },
      id: null,
    }),
  )
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_HTTP_BODY_BYTES) throw new Error('MCP request body is too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function headerValue(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export async function startHostActionMcpServer(
  opts: HostActionMcpServerOptions,
): Promise<HostActionMcpServerHandle> {
  const masterToken = opts.masterToken ?? randomUUID()
  const httpSessions = new Map<string, HttpMcpSession>()
  const httpSessionsBySuperone = new Map<string, Set<HttpMcpSession>>()
  let httpUrl = ''
  let closed = false

  const closeHttpSession = async (session: HttpMcpSession): Promise<void> => {
    if (session.closing) return
    session.closing = true
    const transportId = session.transport.sessionId
    if (transportId && httpSessions.get(transportId) === session) {
      httpSessions.delete(transportId)
    }
    const set = httpSessionsBySuperone.get(session.superoneSessionId)
    if (set) {
      set.delete(session)
      if (set.size === 0) httpSessionsBySuperone.delete(session.superoneSessionId)
    }
    await session.server.close().catch(() => undefined)
  }

  const httpServer: HttpServer = createHttpServer((req, res) => {
    void handleHttpRequest(req, res).catch((err) => {
      writeHttpError(res, 500, err instanceof Error ? err.message : 'Internal MCP server error')
    })
  })

  async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (closed) {
      writeHttpError(res, 503, 'Host Action MCP server is unavailable')
      return
    }
    if (req.url !== '/mcp') {
      writeHttpError(res, 404, 'Not found')
      return
    }

    const superoneSessionId = headerValue(req, SUPERONE_MCP_SESSION_HEADER.toLowerCase())
    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice('Bearer '.length)
      : null
    if (
      !superoneSessionId ||
      !isValidSuperoneMcpSessionToken(masterToken, superoneSessionId, bearer)
    ) {
      res.setHeader('WWW-Authenticate', 'Bearer')
      writeHttpError(res, 401, 'Unauthorized')
      return
    }

    const expectedHost = new URL(httpUrl).host
    if (req.headers.host !== expectedHost) {
      writeHttpError(res, 403, 'Invalid host')
      return
    }

    const transportId = headerValue(req, 'mcp-session-id')
    let session = transportId ? httpSessions.get(transportId) : undefined
    let createdSession = false
    let body: unknown
    try {
      if (req.method === 'POST') body = await readJsonBody(req)
    } catch (err) {
      writeHttpError(res, 400, err instanceof Error ? err.message : 'Invalid request body')
      return
    }

    if (session) {
      if (session.superoneSessionId !== superoneSessionId) {
        writeHttpError(res, 403, 'MCP session does not belong to this SuperOne session')
        return
      }
    } else if (!transportId && req.method === 'POST' && isInitializeRequest(body)) {
      try {
        const server = createHostActionMcpServer(superoneSessionId, opts.requestHostAction)
        let sessionRef: HttpMcpSession | undefined
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (id) => {
            if (sessionRef) httpSessions.set(id, sessionRef)
          },
          onsessionclosed: () => {
            if (sessionRef) void closeHttpSession(sessionRef)
          },
        })
        sessionRef = {
          superoneSessionId,
          server,
          transport,
          closing: false,
        }
        session = sessionRef
        createdSession = true
        let set = httpSessionsBySuperone.get(superoneSessionId)
        if (!set) {
          set = new Set()
          httpSessionsBySuperone.set(superoneSessionId, set)
        }
        set.add(session)
        transport.onclose = () => {
          void closeHttpSession(session!)
        }
        await server.connect(transport)
      } catch (err) {
        if (session) await closeHttpSession(session)
        writeHttpError(
          res,
          500,
          err instanceof Error ? err.message : 'Failed to initialize MCP server',
        )
        return
      }
    } else {
      writeHttpError(res, transportId ? 404 : 400, 'No valid MCP session')
      return
    }

    try {
      await session.transport.handleRequest(req, res, body)
      if (createdSession && !session.transport.sessionId) {
        await closeHttpSession(session)
      }
    } catch (err) {
      if (createdSession) await closeHttpSession(session)
      writeHttpError(res, 500, err instanceof Error ? err.message : 'Internal MCP server error')
    }
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', reject)
      resolve()
    })
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    httpServer.close()
    throw new Error('Host Action MCP HTTP server did not bind a TCP port')
  }
  httpUrl = `http://127.0.0.1:${address.port}/mcp`

  return {
    httpUrl,
    masterToken,
    getHttpConfig(sessionId: string) {
      return buildSuperoneMcpHttpConfig(httpUrl, masterToken, sessionId)
    },
    getCodexMcpConfig(sessionId: string) {
      return buildCodexSuperoneMcpConfig(httpUrl, masterToken, sessionId)
    },
    getOpenCodeMcpConfig(sessionId: string) {
      return buildOpenCodeSuperoneMcpConfig(httpUrl, masterToken, sessionId)
    },
    getAcpMcpServer(sessionId: string) {
      return buildAcpSuperoneMcpServer(httpUrl, masterToken, sessionId)
    },
    createClaudeSdkMcp(sessionId: string): ClaudeSdkMcpHandle {
      const server = createHostActionMcpServer(sessionId, opts.requestHostAction)
      const entry = {
        type: 'sdk' as const,
        name: HOST_ACTION_MCP_NAME,
        instance: server,
      } as unknown as McpSdkServerConfigWithInstance
      return {
        mcpServers: { [HOST_ACTION_MCP_NAME]: entry },
        async dispose() {
          await server.close().catch(() => undefined)
        },
      }
    },
    getClaudeHttpMcpServers(sessionId: string) {
      return buildClaudeHttpMcpServers(httpUrl, masterToken, sessionId)
    },
    getClaudeMcpServers(sessionId: string) {
      return buildClaudeHttpMcpServers(httpUrl, masterToken, sessionId)
    },
    async stop() {
      closed = true
      for (const set of httpSessionsBySuperone.values()) {
        for (const s of set) await closeHttpSession(s)
      }
      httpSessions.clear()
      httpSessionsBySuperone.clear()
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
      })
    },
  }
}
