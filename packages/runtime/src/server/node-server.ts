import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  DATABASE_SCHEMA_GENERATION,
  PROTOCOL_GENERATION,
  negotiateHandshake,
} from '@superone/shared/environment'
import type {
  AccessTokenResult,
  AuthService,
  AuthenticatedClient,
  PairExchangeResult,
  WsTicketResult,
} from './auth-service'
import {
  acceptClientHello,
  SecureChannelError,
  type SecureChannel,
} from '@superone/relay-client/secure-channel'
import type { NodeIdentity } from './identity'
import { MAX_NODE_FRAME_BYTES, type NodeSocket } from './node-socket'
import type { RpcContext, RpcResult, RpcStreams } from './rpc-context'

const MAX_JSON_BYTES = {
  pair: 16 * 1024,
  token: 16 * 1024,
  ticket: 8 * 1024,
  default: 64 * 1024,
} as const

const MAX_WS_PAYLOAD = MAX_NODE_FRAME_BYTES

/** One connection's RPC handler; `dispose` closes its push streams with the socket. */
type RpcHandler = ((read: () => unknown) => Promise<void>) & { dispose: () => void }

interface JsonBody {
  [key: string]: unknown
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<JsonBody> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk)
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

/** Per-request fields the transport adds to the host's context. */
export interface NodeRpcRequestContext {
  client: AuthenticatedClient
  requestId?: string
  idempotencyKey?: string
  streams?: RpcStreams
}

export type NodeRpcDispatch<C extends NodeRpcRequestContext = RpcContext> = (
  method: string,
  payload: unknown,
  ctx: C,
) => Promise<RpcResult>

/** Auth surface the transport needs. AuthService satisfies this. */
export interface NodeAuthPort {
  onRevoke: ((clientSessionId: string) => void) | null
  isRevoked(clientSessionId: string): boolean
  peekWsTicket(ticket: string): AuthenticatedClient & { ticketId: string }
  consumeWsTicket(ticket: string): AuthenticatedClient
  exchangePairingToken(input: {
    pairingToken: string
    devicePublicKeyPem: string
    label?: string
    platform?: string
  }): PairExchangeResult
  refreshAccess(input: {
    refreshToken: string
    proofPayload: string
    proofSignature: string
    verifyDeviceProof: (publicKeyPem: string, payload: string, signature: string) => boolean
  }): AccessTokenResult & { refreshToken: string }
  createWsTicket(accessToken: string): WsTicketResult
}

export interface NodeServerOptions<C extends NodeRpcRequestContext = RpcContext> {
  identity: NodeIdentity
  auth: NodeAuthPort | AuthService
  bindHost: string
  bindPort: number
  startedAt?: number
  dispatchRpc: NodeRpcDispatch<C>
  createRpcContext: (client: AuthenticatedClient) => Omit<C, keyof NodeRpcRequestContext>
  onClientDisconnected: (clientSessionId: string) => void
  /** An authenticated socket opened for this client. */
  onClientConnected?: (clientSessionId: string) => void
  verifyDeviceProof: (publicKeyPem: string, payload: string, signature: string) => boolean
  /**
   * Require the pairing-secret encrypted channel for every request except
   * `/health`. Pairing, token refresh, WS tickets and RPC then run as sealed
   * frames on `/ws`; plain HTTP auth endpoints and ticketed upgrades are refused.
   */
  secureChannel?: NodeSecureChannelOptions
  /**
   * Accept a TCP connection only when this returns true for its peer address.
   * Checked on `connection`, before any HTTP parsing or auth work.
   */
  allowRemoteAddress?: (address: string | undefined) => boolean
}

export interface NodeSecureChannelOptions {
  /** Pairing secret (hex) for a channel key id, or null when unknown. */
  resolveSecret(keyId: string): string | null
}

/** Handshake plus attach must finish within this window. */
const CHANNEL_SETUP_TIMEOUT_MS = 30_000
/** Handshake messages are small JSON text frames. */
const MAX_CHANNEL_HANDSHAKE_BYTES = 4 * 1024
const AUTH_PATHS = new Set(['/v1/pair', '/v1/token', '/v1/ws-ticket'])

export interface NodeServerHandle {
  httpServer: Server
  wss: WebSocketServer
  url: string
  /** Close all sockets for a revoked client session. */
  closeSocketsForClient(clientSessionId: string): void
  /**
   * Authenticated clients connected now, one entry per socket: the peer
   * address of a direct socket, or null for one that came through a relay slot.
   */
  connectedClients(): Array<{ clientSessionId: string; remoteAddress: string | null }>
  /**
   * Serve the encrypted channel on a socket that did not arrive through this
   * HTTP server (a relay slot). Only with `secureChannel`.
   */
  acceptChannelSocket(socket: NodeSocket): void
  close(): Promise<void>
}

/**
 * Authenticated HTTP + WebSocket node server.
 * Default bind is loopback for SSH-forward deployments.
 *
 * RPC dispatch and watch-buffer cleanup are injected so both the CLI host and
 * a future desktop embed can share this transport.
 */
export async function startNodeServer<C extends NodeRpcRequestContext = RpcContext>(
  opts: NodeServerOptions<C>,
): Promise<NodeServerHandle> {
  const activeSockets = new Map<NodeSocket, AuthenticatedClient>()
  /** Peer address per socket; null for a relay slot (`acceptChannelSocket`). */
  const socketPeers = new WeakMap<NodeSocket, string | null>()

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
    opts.onClientDisconnected(clientSessionId)
  }

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

  if (opts.allowRemoteAddress) {
    const allow = opts.allowRemoteAddress
    // Ahead of the HTTP parser's own listener, so a refused peer is never parsed.
    httpServer.prependListener('connection', (socket) => {
      if (!allow(socket.remoteAddress)) socket.destroy()
    })
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD })

  /** Peek, prove and consume a WS ticket; throws `unauthorized` on any failure. */
  const authorizeWsTicket = (
    ticket: string,
    proofPayload: string | null | undefined,
    proofSignature: string | null | undefined,
  ): AuthenticatedClient => {
    const peeked = opts.auth.peekWsTicket(ticket)
    if (!proofPayload || !proofSignature) {
      throw Object.assign(new Error('ws proof required'), { code: 'unauthorized' })
    }
    if (proofPayload !== ticket.split('.')[0] && proofPayload !== ticket) {
      throw Object.assign(new Error('proof payload must bind ticket'), { code: 'unauthorized' })
    }
    if (!opts.verifyDeviceProof(peeked.devicePublicKeyPem, proofPayload, proofSignature)) {
      throw Object.assign(new Error('device proof failed for ws ticket'), { code: 'unauthorized' })
    }
    return opts.auth.consumeWsTicket(ticket)
  }

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

    const headerTicket =
      (req.headers['x-superone-ws-ticket'] as string | undefined) ||
      (Array.isArray(req.headers['sec-websocket-protocol'])
        ? req.headers['sec-websocket-protocol'][0]
        : req.headers['sec-websocket-protocol']?.split(',')[0]?.trim())
    const ticket = headerTicket || url.searchParams.get('ticket')

    if (opts.secureChannel) {
      // A ticket outside the channel would travel in clear; authentication
      // happens inside the channel instead (`attach`).
      if (ticket) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        socketPeers.set(ws, req.socket.remoteAddress ?? null)
        serveSecureChannel(ws, opts.secureChannel!)
      })
      return
    }

    const proofPayload =
      (req.headers['x-superone-ws-proof'] as string | undefined) || url.searchParams.get('proof')
    const proofSignature =
      (req.headers['x-superone-ws-sig'] as string | undefined) || url.searchParams.get('sig')

    if (!ticket) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    try {
      const client = authorizeWsTicket(ticket, proofPayload, proofSignature)
      wss.handleUpgrade(req, socket, head, (ws) => {
        socketPeers.set(ws, req.socket.remoteAddress ?? null)
        activeSockets.set(ws, client)
        opts.onClientConnected?.(client.clientSessionId)
        const handle = createRpcHandler((msg) => ws.send(JSON.stringify(msg)), (code, reason) => ws.close(code, reason), client)
        ws.on('message', (data) => void handle(() => JSON.parse(data.toString())))
        trackClose(ws, handle.dispose)
      })
    } catch (err) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      void err
    }
  })

  /**
   * Channel lifecycle on one socket: text handshake (hello → challenge →
   * proof), then sealed binary frames. Before `attach` only auth exchanges are
   * served; after it, the same RPC handler as a ticketed plain socket.
   */
  const serveSecureChannel = (ws: NodeSocket, channelOpts: NodeSecureChannelOptions): void => {
    let accept: ReturnType<typeof acceptClientHello> | null = null
    let channel: SecureChannel | null = null
    let rpc: RpcHandler | null = null
    const send = (msg: unknown) => {
      if (channel) ws.send(channel.seal(msg))
    }
    const setupTimer = setTimeout(() => ws.close(4408, 'channel_setup_timeout'), CHANNEL_SETUP_TIMEOUT_MS)
    setupTimer.unref?.()
    trackClose(ws, () => {
      clearTimeout(setupTimer)
      rpc?.dispose()
    })

    ws.on('message', (data, isBinary) => {
      const bytes = data as Buffer
      try {
        if (!channel) {
          if (isBinary || bytes.length > MAX_CHANNEL_HANDSHAKE_BYTES) {
            throw new SecureChannelError('channel_protocol', 'expected a handshake text frame')
          }
          const msg = JSON.parse(bytes.toString('utf8')) as unknown
          if (!accept) {
            accept = acceptClientHello(msg, (keyId) => channelOpts.resolveSecret(keyId))
            ws.send(JSON.stringify(accept.challenge))
            return
          }
          channel = accept.finish(msg)
          send({ type: 'channel_ready' })
          return
        }
        if (!isBinary) throw new SecureChannelError('channel_protocol', 'expected a sealed binary frame')
        const payload = channel.open(bytes)
        if (rpc) {
          void rpc(() => payload)
          return
        }
        handlePreAttach(payload)
      } catch (err) {
        const code = err instanceof SecureChannelError ? err.code : 'channel_protocol'
        ws.close(4401, code)
      }
    })

    const handlePreAttach = (payload: unknown): void => {
      const msg = (payload ?? {}) as {
        type?: string
        requestId?: string
        path?: string
        body?: JsonBody
        accessToken?: string
        ticket?: string
        proof?: string
        sig?: string
      }
      const requestId = msg.requestId || 'unknown'
      if (msg.type === 'auth' && typeof msg.path === 'string' && AUTH_PATHS.has(msg.path)) {
        const result = handleAuthRequest(msg.path, msg.body ?? {}, msg.accessToken ?? null, opts)
        send({ type: 'auth_result', requestId, status: result.status, body: result.body })
        return
      }
      if (msg.type === 'attach' && typeof msg.ticket === 'string') {
        let client: AuthenticatedClient
        try {
          client = authorizeWsTicket(msg.ticket, msg.proof, msg.sig)
        } catch (err) {
          const e = err as { code?: string; message?: string }
          send({ type: 'rpc_error', requestId, error: { code: e.code ?? 'unauthorized', message: e.message ?? 'attach failed' } })
          ws.close(4401, 'unauthorized')
          return
        }
        clearTimeout(setupTimer)
        activeSockets.set(ws, client)
        opts.onClientConnected?.(client.clientSessionId)
        rpc = createRpcHandler(send, (code, reason) => ws.close(code, reason), client)
        send({ type: 'attach_ok', requestId })
        return
      }
      send({
        type: 'rpc_error',
        requestId,
        error: { code: 'unauthorized', message: 'attach with a WebSocket ticket before RPC' },
      })
    }
  }

  const trackClose = (ws: NodeSocket, onClose?: () => void): void => {
    ws.on('close', () => {
      onClose?.()
      const client = activeSockets.get(ws)
      activeSockets.delete(ws)
      if (!client) return
      let stillConnected = false
      for (const c of activeSockets.values()) {
        if (c.clientSessionId === client.clientSessionId) {
          stillConnected = true
          break
        }
      }
      if (!stillConnected) {
        opts.onClientDisconnected(client.clientSessionId)
      }
    })
  }

  /** RPC message handling shared by plain ticketed sockets and attached channels. */
  const createRpcHandler = (
    send: (msg: unknown) => void,
    closeSocket: (code: number, reason: string) => void,
    client: AuthenticatedClient,
  ): RpcHandler => {
    const ctxBase = opts.createRpcContext(client)
    let negotiatedGeneration: { protocol: number; databaseSchema: number } | undefined
    const streamClosers = new Map<string, () => void>()
    const streams: RpcStreams = {
      open(subscriptionId, close) {
        streamClosers.get(subscriptionId)?.()
        streamClosers.set(subscriptionId, close)
      },
      close(subscriptionId) {
        streamClosers.get(subscriptionId)?.()
        streamClosers.delete(subscriptionId)
      },
      push: send,
    }

    const handle = async (read: () => unknown): Promise<void> => {
      let requestId = 'unknown'
      try {
        if (opts.auth.isRevoked(client.clientSessionId)) {
          closeSocket(4001, 'session_revoked')
          return
        }

        const msg = read() as {
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
          send({ type: 'pong', requestId })
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
            send({
              type: 'rpc_error',
              requestId,
              error: { code: 'protocol_incompatible', message: result.reason },
            })
            closeSocket(4002, 'protocol_incompatible')
            return
          }
          negotiatedGeneration = { protocol: result.protocol, databaseSchema: result.databaseSchema }
          send({
            type: 'handshake_ok',
            requestId,
            result: {
              protocol: result.protocol,
              databaseSchema: result.databaseSchema,
              environmentId: opts.identity.environmentId,
            },
          })
          return
        }

        if (msg.type !== 'rpc' && !msg.method) {
          send({
            type: 'rpc_error',
            requestId,
            error: { code: 'invalid_argument', message: 'expected rpc message' },
          })
          return
        }

        const method = msg.method || ''
        const bootstrapRead =
          method === 'environment.descriptor' ||
          method === 'environment.health' ||
          method === 'environment.systemInfo'
        if (!negotiatedGeneration && !bootstrapRead) {
          send({
            type: 'rpc_error',
            requestId,
            error: {
              code: 'failed_precondition',
              message: 'handshake required before non-bootstrap RPC',
            },
          })
          return
        }
        if (negotiatedGeneration) {
          if (msg.protocolVersion !== negotiatedGeneration.protocol) {
            send({
              type: 'rpc_error',
              requestId,
              error: {
                code: 'protocol_incompatible',
                message:
                  msg.protocolVersion === undefined
                    ? 'protocolVersion required on RPC envelopes after handshake'
                    : `protocolVersion ${msg.protocolVersion} not negotiated`,
              },
            })
            return
          }
        }

        if (!msg.environmentId || msg.environmentId !== opts.identity.environmentId) {
          send({
            type: 'rpc_error',
            requestId,
            error: {
              code: 'environment_mismatch',
              message: msg.environmentId
                ? 'environmentId does not match this node'
                : 'environmentId is required on every RPC envelope',
            },
          })
          return
        }

        const result = await opts.dispatchRpc(method, msg.payload, {
          ...ctxBase,
          client,
          requestId,
          idempotencyKey: msg.idempotencyKey,
          streams,
        } as C)
        if (result.error) {
          send({ type: 'rpc_error', requestId, error: result.error })
        } else {
          send({ type: 'rpc_result', requestId, result: result.result })
        }
      } catch (err) {
        const e = err as { message?: string; code?: string }
        send({
          type: 'rpc_error',
          requestId,
          error: { code: e.code || 'internal', message: e.message || 'internal error' },
        })
      }
    }
    return Object.assign(handle, {
      dispose: () => {
        for (const close of streamClosers.values()) close()
        streamClosers.clear()
      },
    })
  }

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
    connectedClients() {
      return [...activeSockets].map(([ws, client]) => ({
        clientSessionId: client.clientSessionId,
        remoteAddress: socketPeers.get(ws) ?? null,
      }))
    },
    acceptChannelSocket(socket) {
      if (!opts.secureChannel) throw new Error('acceptChannelSocket requires secureChannel')
      socketPeers.set(socket, null)
      serveSecureChannel(socket, opts.secureChannel)
    },
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

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  opts: Pick<NodeServerOptions<NodeRpcRequestContext>, 'identity' | 'auth' | 'verifyDeviceProof' | 'secureChannel'>,
): Promise<void> {
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

  if (opts.secureChannel) {
    sendJson(res, 403, {
      error: { code: 'channel_required', message: 'this node accepts requests only inside its encrypted channel' },
    })
    return
  }

  if (method === 'POST' && AUTH_PATHS.has(path)) {
    const body = await readJson(req, path === '/v1/ws-ticket' ? MAX_JSON_BYTES.ticket : MAX_JSON_BYTES.pair)
    const result = handleAuthRequest(path, body, getBearer(req), opts)
    sendJson(res, result.status, result.body)
    return
  }

  sendJson(res, 404, { error: { code: 'not_found', message: 'not found' } })
}

/**
 * Pairing, token refresh and WS ticket exchanges. Served over plain HTTP, or
 * as sealed `auth` frames when the node requires its encrypted channel.
 */
function handleAuthRequest(
  path: string,
  body: JsonBody,
  bearer: string | null,
  opts: Pick<NodeServerOptions<NodeRpcRequestContext>, 'auth' | 'verifyDeviceProof'>,
): { status: number; body: unknown } {
  const failure = (err: unknown, fallback: string) => {
    const e = err as { code?: string; message?: string }
    return {
      status: e.code === 'unauthorized' || e.code === 'revoked' ? 401 : 500,
      body: { error: { code: e.code ?? 'internal', message: e.message ?? fallback } },
    }
  }

  if (path === '/v1/pair') {
    const pairingToken = String(body.pairingToken ?? '')
    const devicePublicKeyPem = String(body.devicePublicKeyPem ?? '')
    const label = typeof body.label === 'string' ? body.label : undefined
    const platform = typeof body.platform === 'string' ? body.platform.slice(0, 32) : undefined
    if (!pairingToken || !devicePublicKeyPem) {
      return {
        status: 400,
        body: { error: { code: 'invalid_argument', message: 'pairingToken and devicePublicKeyPem required' } },
      }
    }
    try {
      return { status: 200, body: opts.auth.exchangePairingToken({ pairingToken, devicePublicKeyPem, label, platform }) }
    } catch (err) {
      return failure(err, 'pair failed')
    }
  }

  if (path === '/v1/token') {
    const refreshToken = String(body.refreshToken ?? '')
    const proofPayload = String(body.proofPayload ?? '')
    const proofSignature = String(body.proofSignature ?? '')
    if (!refreshToken || !proofPayload || !proofSignature) {
      return {
        status: 400,
        body: {
          error: { code: 'invalid_argument', message: 'refreshToken, proofPayload, proofSignature required' },
        },
      }
    }
    try {
      const result = opts.auth.refreshAccess({
        refreshToken,
        proofPayload,
        proofSignature,
        verifyDeviceProof: opts.verifyDeviceProof,
      })
      return { status: 200, body: result }
    } catch (err) {
      return failure(err, 'token refresh failed')
    }
  }

  const accessToken = bearer || String(body.accessToken ?? '')
  if (!accessToken) {
    return { status: 401, body: { error: { code: 'unauthorized', message: 'access token required' } } }
  }
  try {
    return { status: 200, body: opts.auth.createWsTicket(accessToken) }
  } catch (err) {
    return failure(err, 'ticket failed')
  }
}
