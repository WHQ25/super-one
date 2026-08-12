import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  DATABASE_SCHEMA_GENERATION,
  PROTOCOL_GENERATION,
  negotiateHandshake,
} from '@superone/shared/environment'
import type { AuthService, AuthenticatedClient } from '../auth/auth-service'
import { verifyPayload } from '../crypto-util'
import type { NodeIdentity } from '../identity'
import { dispatchRpc, type RpcContext } from '../rpc/handlers'
import type { NodeTerminalManager } from '../terminal/manager'
import type { ProjectRegistry } from '../workspace/project-registry'
import type { WorkspaceFsService } from '../workspace/fs-service'
import type { WorkspaceGitService } from '../workspace/git-service'
import type { SessionRuntime } from '../session/session-runtime'
import type { HarnessManager } from '../session/harness-manager'
import type { ControlLeaseService } from '../session/control-lease'
import type { EventLog } from '../session/event-log'
import type { CollaborationService } from '../session/collaboration'
import type { WorkspaceWatchService } from '../workspace/watch-service'
import type { WorkspaceTailWatchService } from '../workspace/tail-watch-service'
import { IdempotencyService } from '../auth/idempotency'
import type { ProviderStore } from '../provider/provider-store'
import type { AutomationService, AutomationStore } from '@superone/runtime/automations'
import type { DraftStore } from '@superone/runtime/drafts'
import { clearWatchBuffersForClient } from '../rpc/handlers'

const MAX_JSON_BYTES = {
  pair: 16 * 1024,
  token: 16 * 1024,
  ticket: 8 * 1024,
  default: 64 * 1024,
} as const

/** Must cover workspace.readFile/writeFile max (10 MiB) plus RPC framing overhead. */
const MAX_WS_PAYLOAD = 12 * 1024 * 1024

interface JsonBody {
  [key: string]: unknown
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<JsonBody> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > maxBytes) {
      req.destroy()
      throw Object.assign(new Error(`request body exceeds ${maxBytes} bytes`), {
        code: 'invalid_argument',
      })
    }
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  return JSON.parse(raw) as JsonBody
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
  })
  res.end(data)
}

function getBearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization
  if (!h) return null
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return m?.[1] ?? null
}

export interface NodeServerOptions {
  identity: NodeIdentity
  auth: AuthService
  terminals: NodeTerminalManager
  projects: ProjectRegistry
  workspaceFs: WorkspaceFsService
  workspaceGit: WorkspaceGitService
  workspaceWatch: WorkspaceWatchService
  workspaceTailWatch: WorkspaceTailWatchService
  sessions: SessionRuntime
  harnesses: HarnessManager
  leases: ControlLeaseService
  events: EventLog
  collaboration: CollaborationService
  idempotency: IdempotencyService
  providers: ProviderStore
  /** Absolute path to SUPERONE_NODE_HOME/config.json (agent settings). */
  settingsConfigPath: string
  drafts: DraftStore
  automations: AutomationStore
  automationService: AutomationService
  sessionProviders: import('@superone/runtime/session').SessionProviderStore
  bindHost: string
  bindPort: number
  startedAt?: number
  /**
   * When true, harness catalog is pre-marked ready for simulated multi-harness
   * contract tests. Collaboration RPC is always available (node policy).
   */
  simulatedHarness?: boolean
}

export interface NodeServerHandle {
  httpServer: Server
  wss: WebSocketServer
  url: string
  /** Close all sockets for a revoked client session. */
  closeSocketsForClient(clientSessionId: string): void
  close(): Promise<void>
}

/**
 * Authenticated HTTP + WebSocket node server.
 * Default bind is loopback for SSH-forward deployments.
 */
export async function startNodeServer(opts: NodeServerOptions): Promise<NodeServerHandle> {
  const startedAt = opts.startedAt ?? Date.now()
  const activeSockets = new Map<WebSocket, AuthenticatedClient>()
  const negotiated = new WeakMap<WebSocket, { protocol: number; databaseSchema: number }>()

  const closeSocketsForClient = (clientSessionId: string) => {
    for (const [ws, client] of activeSockets) {
      if (client.clientSessionId === clientSessionId) {
        try {
          ws.close(4001, 'session_revoked')
        } catch {
          /* ignore */
        }
        activeSockets.delete(ws)
      }
    }
    opts.workspaceWatch.cancelForClient?.(clientSessionId)
    opts.workspaceTailWatch.cancelForClient?.(clientSessionId)
    clearWatchBuffersForClient(clientSessionId)
  }

  // Wire revoke → socket close
  opts.auth.onRevoke = (clientSessionId) => {
    closeSocketsForClient(clientSessionId)
  }

  const httpServer = createServer(async (req, res) => {
    try {
      await handleHttp(req, res, opts)
    } catch (err) {
      const e = err as { code?: string; message?: string }
      const status =
        e.code === 'unauthorized' || e.code === 'revoked'
          ? 401
          : e.code === 'forbidden'
            ? 403
            : e.code === 'invalid_argument'
              ? 400
              : 500
      sendJson(res, status, {
        error: { code: e.code ?? 'internal', message: e.message ?? 'internal error' },
      })
    }
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD })

  httpServer.on('upgrade', (req, socket, head) => {
    if (opts.identity.identityConflict) {
      socket.write('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }

    // Prefer Sec-WebSocket-Protocol / header over query (query still accepted for legacy tests).
    const headerTicket =
      (req.headers['x-superone-ws-ticket'] as string | undefined) ||
      (Array.isArray(req.headers['sec-websocket-protocol'])
        ? req.headers['sec-websocket-protocol'][0]
        : req.headers['sec-websocket-protocol']?.split(',')[0]?.trim())
    const ticket = headerTicket || url.searchParams.get('ticket')
    const proofPayload = (req.headers['x-superone-ws-proof'] as string | undefined) || url.searchParams.get('proof')
    const proofSignature =
      (req.headers['x-superone-ws-sig'] as string | undefined) || url.searchParams.get('sig')

    if (!ticket) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    try {
      // Peek first so invalid proofs do not burn single-use tickets (DoS).
      const peeked = opts.auth.peekWsTicket(ticket)
      if (!proofPayload || !proofSignature) {
        throw Object.assign(new Error('ws proof required'), { code: 'unauthorized' })
      }
      if (proofPayload !== ticket.split('.')[0] && proofPayload !== ticket) {
        throw Object.assign(new Error('proof payload must bind ticket'), { code: 'unauthorized' })
      }
      if (!verifyPayload(peeked.devicePublicKeyPem, proofPayload, proofSignature)) {
        throw Object.assign(new Error('device proof failed for ws ticket'), { code: 'unauthorized' })
      }
      const client = opts.auth.consumeWsTicket(ticket)

      wss.handleUpgrade(req, socket, head, (ws) => {
        activeSockets.set(ws, client)
        wss.emit('connection', ws, req, client)
      })
    } catch (err) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      void err
    }
  })

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, client: AuthenticatedClient) => {
    const ctxBase = {
      client,
      identity: opts.identity,
      terminals: opts.terminals,
      projects: opts.projects,
      workspaceFs: opts.workspaceFs,
      workspaceGit: opts.workspaceGit,
      workspaceWatch: opts.workspaceWatch,
      workspaceTailWatch: opts.workspaceTailWatch,
      sessions: opts.sessions,
      harnesses: opts.harnesses,
      leases: opts.leases,
      events: opts.events,
      collaboration: opts.collaboration,
      idempotency: opts.idempotency,
      providers: opts.providers,
      settingsConfigPath: opts.settingsConfigPath,
      drafts: opts.drafts,
      automations: opts.automations,
      automationService: opts.automationService,
      sessionProviders: opts.sessionProviders,
      startedAt,
      simulatedHarness: opts.simulatedHarness === true,
    }

    ws.on('message', async (data) => {
      let requestId = 'unknown'
      try {
        // Re-validate session not revoked
        if (opts.auth.isRevoked(client.clientSessionId)) {
          ws.close(4001, 'session_revoked')
          return
        }

        const msg = JSON.parse(data.toString()) as {
          type?: string
          requestId?: string
          method?: string
          payload?: unknown
          environmentId?: string
          protocolVersion?: number
          idempotencyKey?: string
        }
        requestId = msg.requestId || 'unknown'

        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', requestId }))
          return
        }

        if (msg.type === 'handshake') {
          const remote = (msg.payload || {}) as {
            protocol?: unknown
            databaseSchema?: unknown
          }
          const result = negotiateHandshake(
            {
              protocol: { ...PROTOCOL_GENERATION },
              databaseSchema: { ...DATABASE_SCHEMA_GENERATION },
            },
            {
              protocol: remote.protocol as { current: number; min: number; max: number },
              databaseSchema: remote.databaseSchema as { current: number; min: number; max: number },
            },
          )
          if (!result.ok) {
            ws.send(
              JSON.stringify({
                type: 'rpc_error',
                requestId,
                error: { code: 'protocol_incompatible', message: result.reason },
              }),
            )
            ws.close(4002, 'protocol_incompatible')
            return
          }
          negotiated.set(ws, { protocol: result.protocol, databaseSchema: result.databaseSchema })
          ws.send(
            JSON.stringify({
              type: 'handshake_ok',
              requestId,
              result: {
                protocol: result.protocol,
                databaseSchema: result.databaseSchema,
                environmentId: opts.identity.environmentId,
              },
            }),
          )
          return
        }

        if (msg.type !== 'rpc' && !msg.method) {
          ws.send(
            JSON.stringify({
              type: 'rpc_error',
              requestId,
              error: { code: 'invalid_argument', message: 'expected rpc message' },
            }),
          )
          return
        }

        // Handshake required before any mutable/non-bootstrap RPC.
        const method = msg.method || ''
        const bootstrapRead =
          method === 'environment.descriptor' ||
          method === 'environment.health' ||
          method === 'environment.systemInfo'
        if (!negotiated.get(ws) && !bootstrapRead) {
          ws.send(
            JSON.stringify({
              type: 'rpc_error',
              requestId,
              error: {
                code: 'failed_precondition',
                message: 'handshake required before non-bootstrap RPC',
              },
            }),
          )
          return
        }
        if (negotiated.get(ws)) {
          if (msg.protocolVersion !== negotiated.get(ws)!.protocol) {
            ws.send(
              JSON.stringify({
                type: 'rpc_error',
                requestId,
                error: {
                  code: 'protocol_incompatible',
                  message:
                    msg.protocolVersion === undefined
                      ? 'protocolVersion required on RPC envelopes after handshake'
                      : `protocolVersion ${msg.protocolVersion} not negotiated`,
                },
              }),
            )
            return
          }
        }

        if (!msg.environmentId || msg.environmentId !== opts.identity.environmentId) {
          ws.send(
            JSON.stringify({
              type: 'rpc_error',
              requestId,
              error: {
                code: 'environment_mismatch',
                message: msg.environmentId
                  ? 'environmentId does not match this node'
                  : 'environmentId is required on every RPC envelope',
              },
            }),
          )
          return
        }

        const result = await dispatchRpc(method, msg.payload, {
          ...ctxBase,
          client,
          requestId,
          idempotencyKey: msg.idempotencyKey,
        })
        if (result.error) {
          ws.send(JSON.stringify({ type: 'rpc_error', requestId, error: result.error }))
        } else {
          ws.send(JSON.stringify({ type: 'rpc_result', requestId, result: result.result }))
        }
      } catch (err) {
        const e = err as { message?: string; code?: string }
        ws.send(
          JSON.stringify({
            type: 'rpc_error',
            requestId,
            error: { code: e.code || 'internal', message: e.message || 'internal error' },
          }),
        )
      }
    })

    ws.on('close', () => {
      // Only cancel watches if this client has no other active sockets
      // (endpoint failover may open a new socket before the old one closes).
      activeSockets.delete(ws)
      let stillConnected = false
      for (const c of activeSockets.values()) {
        if (c.clientSessionId === client.clientSessionId) {
          stillConnected = true
          break
        }
      }
      if (!stillConnected) {
        opts.workspaceWatch.cancelForClient?.(client.clientSessionId)
        opts.workspaceTailWatch.cancelForClient?.(client.clientSessionId)
        clearWatchBuffersForClient(client.clientSessionId)
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(opts.bindPort, opts.bindHost, () => resolve())
  })

  const address = httpServer.address()
  const port = typeof address === 'object' && address ? address.port : opts.bindPort
  const url = `http://${opts.bindHost}:${port}`

  return {
    httpServer,
    wss,
    url,
    closeSocketsForClient,
    async close() {
      for (const ws of activeSockets.keys()) ws.close()
      activeSockets.clear()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}

async function handleHttp(req: IncomingMessage, res: ServerResponse, opts: NodeServerOptions): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const path = url.pathname
  const method = req.method || 'GET'

  if (method === 'GET' && path === '/health') {
    sendJson(res, 200, {
      ok: !opts.identity.identityConflict,
      environmentId: opts.identity.environmentId,
      nodePublicKeyFingerprint: opts.identity.publicKeyFingerprint,
      identityConflict: opts.identity.identityConflict === true,
    })
    return
  }

  // Identity conflict: only health + identity regenerate recovery; no pairing/auth.
  if (opts.identity.identityConflict) {
    sendJson(res, 409, {
      error: {
        code: 'identity_conflict',
        message:
          'node binding mismatch (possible clone/restore). Run `superone identity regenerate` locally before network auth.',
      },
    })
    return
  }

  if (method === 'GET' && path === '/v1/descriptor') {
    sendJson(res, 401, {
      error: { code: 'unauthorized', message: 'use authenticated RPC environment.descriptor' },
    })
    return
  }

  if (method === 'POST' && path === '/v1/pair') {
    const body = await readJson(req, MAX_JSON_BYTES.pair)
    const pairingToken = String(body.pairingToken ?? '')
    const devicePublicKeyPem = String(body.devicePublicKeyPem ?? '')
    const label = typeof body.label === 'string' ? body.label : undefined
    if (!pairingToken || !devicePublicKeyPem) {
      sendJson(res, 400, {
        error: { code: 'invalid_argument', message: 'pairingToken and devicePublicKeyPem required' },
      })
      return
    }
    try {
      const result = opts.auth.exchangePairingToken({ pairingToken, devicePublicKeyPem, label })
      sendJson(res, 200, result)
    } catch (err) {
      const e = err as { code?: string; message?: string }
      sendJson(res, e.code === 'unauthorized' || e.code === 'revoked' ? 401 : 500, {
        error: { code: e.code ?? 'internal', message: e.message ?? 'pair failed' },
      })
    }
    return
  }

  if (method === 'POST' && path === '/v1/token') {
    const body = await readJson(req, MAX_JSON_BYTES.token)
    const refreshToken = String(body.refreshToken ?? '')
    const proofPayload = String(body.proofPayload ?? '')
    const proofSignature = String(body.proofSignature ?? '')
    if (!refreshToken || !proofPayload || !proofSignature) {
      sendJson(res, 400, {
        error: {
          code: 'invalid_argument',
          message: 'refreshToken, proofPayload, proofSignature required',
        },
      })
      return
    }
    try {
      const result = opts.auth.refreshAccess({
        refreshToken,
        proofPayload,
        proofSignature,
        verifyDeviceProof: (publicKeyPem, payload, signature) =>
          verifyPayload(publicKeyPem, payload, signature),
      })
      sendJson(res, 200, result)
    } catch (err) {
      const e = err as { code?: string; message?: string }
      sendJson(res, e.code === 'unauthorized' || e.code === 'revoked' ? 401 : 500, {
        error: { code: e.code ?? 'internal', message: e.message ?? 'token refresh failed' },
      })
    }
    return
  }

  if (method === 'POST' && path === '/v1/ws-ticket') {
    let accessToken = getBearer(req)
    if (!accessToken) {
      const body = await readJson(req, MAX_JSON_BYTES.ticket)
      accessToken = String(body.accessToken ?? '')
    }
    if (!accessToken) {
      sendJson(res, 401, { error: { code: 'unauthorized', message: 'access token required' } })
      return
    }
    try {
      const ticket = opts.auth.createWsTicket(accessToken)
      sendJson(res, 200, ticket)
    } catch (err) {
      const e = err as { code?: string; message?: string }
      sendJson(res, e.code === 'unauthorized' || e.code === 'revoked' ? 401 : 500, {
        error: { code: e.code ?? 'internal', message: e.message ?? 'ticket failed' },
      })
    }
    return
  }

  sendJson(res, 404, { error: { code: 'not_found', message: 'not found' } })
}
