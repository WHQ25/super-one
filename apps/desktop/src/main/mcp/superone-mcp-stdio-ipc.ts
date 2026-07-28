import { randomUUID } from 'crypto'
import { chmodSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'http'
import net, { type Server, type Socket } from 'net'
import { dirname, join } from 'path'
import { app } from 'electron'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import log from '../logger'
import {
  isValidSuperoneMcpSessionToken,
  SUPERONE_MCP_SESSION_HEADER,
} from './superone-mcp-auth'
import { setSuperoneMcpHttpSessionCloser } from './superone-mcp-http-state'
import { createSuperoneMcpServer, getSessionHost, setToolSyncCallbacks } from './superone-mcp-server'
import { executeSuperoneMcpTool, listSuperoneMcpTools } from './superone-mcp-tool-surface'
import { setSuperoneMcpBridgeRuntime } from './superone-mcp-stdio-state'

type RequestId = string | number

interface IpcClient {
  socket: Socket
  buffer: string
  sessionId: string | null
}

interface IpcState {
  server: Server
  endpoint: string
  token: string
  clients: Set<IpcClient>
  httpServer: HttpServer
  httpUrl: string
  httpSessions: Map<string, HttpMcpSession>
  httpSessionsBySuperone: Map<string, Set<HttpMcpSession>>
}

interface HttpMcpSession {
  superoneSessionId: string
  server: McpServer
  transport: StreamableHTTPServerTransport
  closing: boolean
}

let state: IpcState | null = null

const MAX_HTTP_BODY_BYTES = 1024 * 1024

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readRequestId(value: unknown): RequestId | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

function writeMessage(socket: Socket, message: Record<string, unknown>): void {
  socket.write(`${JSON.stringify(message)}\n`)
}

function socketEndpoint(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\superone-mcp-${process.pid}-${randomUUID()}`
  }
  return join(app.getPath('userData'), `superone-mcp-${process.pid}.sock`)
}

function bridgeScriptPath(): string {
  return join(__dirname, 'superone-mcp-stdio-bridge.js')
}

function prepareEndpoint(endpoint: string): void {
  if (process.platform === 'win32') return
  mkdirSync(dirname(endpoint), { recursive: true })
  if (existsSync(endpoint)) unlinkSync(endpoint)
}

async function handleRequest(client: IpcClient, raw: unknown): Promise<void> {
  const rec = readRecord(raw)
  if (!rec) return
  const id = readRequestId(rec.id)
  const method = readString(rec.method)
  const token = readString(rec.token)
  const params = readRecord(rec.params) ?? {}

  if (id === null || !method) return

  try {
    if (!state) throw new Error('SuperOne MCP bridge is unavailable')

    const sessionId = readString(params.sessionId)
    if (!sessionId) throw new Error('Missing sessionId')
    if (!isValidSuperoneMcpSessionToken(state.token, sessionId, token)) {
      throw new Error('Unauthorized SuperOne MCP bridge request')
    }

    if (method === 'tools/list') {
      client.sessionId = sessionId
      const tools = listSuperoneMcpTools(sessionId)
      log.debug('[mcp-stdio-ipc] tools/list sid=%s → %d tools: %s', sessionId, tools.length, tools.map((t) => t.name).join(','))
      writeMessage(client.socket, { id, result: { tools } })
      return
    }

    if (method === 'tools/call') {
      const toolName = readString(params.name)
      if (!toolName) throw new Error('Missing tool name')
      const args = readRecord(params.arguments) ?? {}
      const result = await executeSuperoneMcpTool(sessionId, toolName, args)
      writeMessage(client.socket, { id, result })
      return
    }

    throw new Error(`Unknown SuperOne MCP bridge method: ${method}`)
  } catch (err) {
    writeMessage(client.socket, {
      id,
      error: { message: err instanceof Error ? err.message : String(err) },
    })
  }
}

function handleSocket(socket: Socket): void {
  if (!state) {
    socket.destroy()
    return
  }

  const client: IpcClient = { socket, buffer: '', sessionId: null }
  state.clients.add(client)
  socket.setEncoding('utf8')

  socket.on('data', (chunk: string) => {
    client.buffer += chunk
    let index = client.buffer.indexOf('\n')
    while (index >= 0) {
      const line = client.buffer.slice(0, index).trim()
      client.buffer = client.buffer.slice(index + 1)
      if (line) {
        try {
          void handleRequest(client, JSON.parse(line))
        } catch (err) {
          log.warn('[mcp-stdio-ipc] invalid bridge message: %s', err instanceof Error ? err.message : String(err))
        }
      }
      index = client.buffer.indexOf('\n')
    }
  })

  socket.on('close', () => {
    state?.clients.delete(client)
  })
  socket.on('error', (err) => {
    log.warn('[mcp-stdio-ipc] socket error: %s', err instanceof Error ? err.message : String(err))
  })
}

function writeHttpError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32000, message },
    id: null,
  }))
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

async function closeHttpSession(owner: IpcState, session: HttpMcpSession): Promise<void> {
  if (session.closing) return
  session.closing = true
  const transportId = session.transport.sessionId
  if (transportId && owner.httpSessions.get(transportId) === session) {
    owner.httpSessions.delete(transportId)
  }
  const superoneSessions = owner.httpSessionsBySuperone.get(session.superoneSessionId)
  if (superoneSessions) {
    superoneSessions.delete(session)
    if (superoneSessions.size === 0) owner.httpSessionsBySuperone.delete(session.superoneSessionId)
  }
  await session.server.close().catch(() => undefined)
}

async function closeHttpSessionsForSuperoneSession(owner: IpcState, sessionId: string): Promise<void> {
  const sessions = [...(owner.httpSessionsBySuperone.get(sessionId) ?? [])]
  await Promise.all(sessions.map((session) => closeHttpSession(owner, session)))
}

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const current = state
  if (!current) {
    writeHttpError(res, 503, 'SuperOne MCP server is unavailable')
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
  if (!superoneSessionId || !isValidSuperoneMcpSessionToken(current.token, superoneSessionId, bearer)) {
    res.setHeader('WWW-Authenticate', 'Bearer')
    writeHttpError(res, 401, 'Unauthorized')
    return
  }
  const expectedHost = new URL(current.httpUrl).host
  if (req.headers.host !== expectedHost) {
    writeHttpError(res, 403, 'Invalid host')
    return
  }

  const transportId = headerValue(req, 'mcp-session-id')
  let session = transportId ? current.httpSessions.get(transportId) : undefined
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
      const projectPath = getSessionHost()?.getSession(superoneSessionId)?.projectPath
      const config = createSuperoneMcpServer(superoneSessionId, projectPath)
      const server = config.instance as unknown as McpServer
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (id) => {
          current.httpSessions.set(id, session!)
        },
        onsessionclosed: () => closeHttpSession(current, session!),
      })
      session = { superoneSessionId, server, transport, closing: false }
      createdSession = true
      let superoneSessions = current.httpSessionsBySuperone.get(superoneSessionId)
      if (!superoneSessions) {
        superoneSessions = new Set()
        current.httpSessionsBySuperone.set(superoneSessionId, superoneSessions)
      }
      superoneSessions.add(session)
      transport.onclose = () => {
        void closeHttpSession(current, session!)
      }
      await server.connect(transport)
    } catch (err) {
      if (session) await closeHttpSession(current, session)
      log.warn('[mcp-http] initialization failed: %s', err instanceof Error ? err.message : String(err))
      writeHttpError(res, 500, 'Failed to initialize MCP server')
      return
    }
  } else {
    writeHttpError(res, transportId ? 404 : 400, 'No valid MCP session')
    return
  }

  try {
    await session.transport.handleRequest(req, res, body)
    if (createdSession && !session.transport.sessionId) {
      await closeHttpSession(current, session)
    }
  } catch (err) {
    if (createdSession) await closeHttpSession(current, session)
    log.warn('[mcp-http] request failed: %s', err instanceof Error ? err.message : String(err))
    writeHttpError(res, 500, 'Internal MCP server error')
  }
}

function notifyToolsChanged(sessionId: string): void {
  if (!state) return
  for (const client of state.clients) {
    if (client.sessionId !== sessionId) continue
    writeMessage(client.socket, { method: 'tools/changed', params: { sessionId } })
  }
}

export async function startSuperoneMcpStdioBridge(): Promise<void> {
  if (state) return

  const endpoint = socketEndpoint()
  const token = randomUUID()
  prepareEndpoint(endpoint)

  const server = net.createServer(handleSocket)
  const clients = new Set<IpcClient>()
  const httpServer = createHttpServer((req, res) => {
    void handleHttpRequest(req, res).catch((err) => {
      log.error('[mcp-http] unhandled request error:', err)
      writeHttpError(res, 500, 'Internal MCP server error')
    })
  })
  const httpSessions = new Map<string, HttpMcpSession>()
  const httpSessionsBySuperone = new Map<string, Set<HttpMcpSession>>()
  state = { server, endpoint, token, clients, httpServer, httpUrl: '', httpSessions, httpSessionsBySuperone }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(endpoint, () => {
        server.off('error', reject)
        resolve()
      })
    })
    if (process.platform !== 'win32') {
      chmodSync(endpoint, 0o600)
    }
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject)
      httpServer.listen(0, '127.0.0.1', () => {
        httpServer.off('error', reject)
        resolve()
      })
    })
  } catch (err) {
    server.close()
    httpServer.close()
    state = null
    throw err
  }

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    server.close()
    httpServer.close()
    state = null
    throw new Error('SuperOne MCP HTTP server did not bind a TCP port')
  }
  const httpUrl = `http://127.0.0.1:${address.port}/mcp`
  state.httpUrl = httpUrl
  const owner = state
  setSuperoneMcpBridgeRuntime({
    endpoint,
    httpUrl,
    token,
    bridgeScriptPath: bridgeScriptPath(),
  })
  setSuperoneMcpHttpSessionCloser((sessionId) => closeHttpSessionsForSuperoneSession(owner, sessionId))
  setToolSyncCallbacks({ toolsChanged: notifyToolsChanged })
  server.on('error', (err) => {
    log.error('[mcp-stdio-ipc] server error:', err)
  })
  httpServer.on('error', (err) => {
    log.error('[mcp-http] server error:', err)
  })
  log.info('[mcp-transport] stdio IPC=%s HTTP=%s', endpoint, httpUrl)
}

export function stopSuperoneMcpStdioBridge(): void {
  const current = state
  setToolSyncCallbacks(null)
  setSuperoneMcpBridgeRuntime(null)
  setSuperoneMcpHttpSessionCloser(null)
  state = null
  if (!current) return

  for (const client of current.clients) {
    client.socket.destroy()
  }
  current.clients.clear()
  current.server.close()
  for (const sessions of current.httpSessionsBySuperone.values()) {
    for (const session of sessions) void closeHttpSession(current, session)
  }
  current.httpSessions.clear()
  current.httpSessionsBySuperone.clear()
  current.httpServer.close()

  if (process.platform !== 'win32') {
    try {
      unlinkSync(current.endpoint)
    } catch {}
  }
}
