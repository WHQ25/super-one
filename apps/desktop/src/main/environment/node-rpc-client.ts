import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import type { ControlLease, EnvironmentLiveStatus, EnvironmentUsageReport, ExecutionEnvironmentDescriptor, TerminalReadResult, TopicSubscribeInput } from '@superone/shared/environment'
import { DATABASE_SCHEMA_GENERATION, PROTOCOL_GENERATION } from '@superone/shared/environment'
import { isNodeMutatingCall } from '@superone/runtime/server/rpc-mutating-methods'
import { dialWebSocket } from '@superone/runtime/server/node-socket'
import {
  establishSecureChannel,
  type ChannelCredential,
  type NodeSocket,
  type NodeSocketDialer,
  type SecureChannel,
} from '@superone/runtime/server/secure-channel-client'
import { nodeWireCompression } from '@superone/runtime/server/wire-compression'
import { RpcConnection, type RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import { WireDecoder, WireEncoder } from '@superone/shared/environment/wire'
import type { DetailUpdate } from '@superone/shared/environment/detail'
import type { TopicRef } from '@superone/shared/environment/topics'
import { signWithDeviceKey } from './node-auth-client'

/** A socket's encrypted channel; wire framing starts once the generation handshake succeeds. */
type ChannelState = {
  channel: SecureChannel
  encoder: WireEncoder
  decoder: WireDecoder
  framing: boolean
}

export interface NodeRpcClientOptions {
  /** http(s) base URL, e.g. http://127.0.0.1:7788 */
  baseUrl: string
  /** Obtain a fresh single-use WS ticket. */
  getWsTicket: () => Promise<string>
  /** Device private key PEM for WS proof-of-possession. */
  devicePrivateKeyPem: string
  expectedEnvironmentId?: string
  expectedNodePublicKeyFingerprint?: string
  /**
   * When true, transport recovery is owned by ConnectionSupervisor: rpc() will
   * not self-dial or resend after socket loss. Unexpected close of the current
   * promoted socket invokes onUnexpectedDisconnect once.
   */
  supervised?: boolean
  /**
   * Fired after the current promoted socket is lost — either an unexpected
   * close, an unanswered heartbeat, or an rpc that timed out on it.
   */
  onUnexpectedDisconnect?: (error: string) => void
  /** Application-level keepalive period. Default 15s; 0 disables. */
  heartbeatIntervalMs?: number
  /**
   * The node's encrypted-channel credential. When set, the socket opens the
   * channel first and attaches with the ticket inside it instead of headers.
   */
  channel?: ChannelCredential
  /**
   * Opens channel sockets (a relay slot instead of a direct WebSocket).
   * Only with `channel`: the relay carries nothing but channel frames.
   */
  dial?: NodeSocketDialer
}

/** Where the client dials: an http(s) base URL, and for the relay the slot dialer. */
export interface NodeRoute {
  baseUrl: string
  dial?: NodeSocketDialer
}

/** An open `topic.subscribe` stream. */
export interface TopicStream {
  close(): void
  /** Change the stream's topics in place; resolves once the node applied them. */
  update(topics: TopicRef[]): Promise<void>
}

/** Pure reads the sidebar, status bar and pickers issue alike; identical ones in flight share a request. */
const COALESCED_READS: ReadonlySet<string> = new Set([
  'environment.descriptor', 'environment.health', 'environment.status', 'environment.usage',
  'project.list', 'session.list', 'git.status', 'git.branches',
])

const RPC_TIMEOUT_MS = 15_000
/** Read-only git that still shells out on the node (status/branches/diff). */
const GIT_READ_RPC_TIMEOUT_MS = 30_000
/** Long-running mutating git / large file RPCs (worktree, clone, handoff, bulk fs). */
const LONG_RPC_TIMEOUT_MS = 300_000
const HANDSHAKE_TIMEOUT_MS = 10_000
/** One reconnect+resend after transport loss within a single rpc() call. */
const TRANSPORT_RETRY_ATTEMPTS = 2
/**
 * Application-level keepalive. A tunneled socket can stay readyState=OPEN long
 * after the tunnel died, so `close` alone is not a reliable liveness signal.
 */
const HEARTBEAT_INTERVAL_MS = 15_000
/** Consecutive unanswered pings before the socket is declared dead. */
const HEARTBEAT_MAX_MISSED = 2

function rpcTimeoutMs(method: string): number | undefined {
  // Native provider deadlines still bound server work; user input has no deadline.
  // Heartbeats/close reject a lost transport without resending an App operation.
  if (method === 'mcpApps.provider') return undefined
  // Only truly long mutators get 5 minutes — status/branches must not sit on 300s.
  if (
    method === 'git.clone' ||
    method === 'git.worktreeActivate' ||
    method === 'git.worktreeAssignBranch' ||
    method === 'git.worktreeHandoff' ||
    method === 'git.switchBranch' ||
    method === 'git.createBranch' ||
    method === 'session.fork' ||
    method === 'project.clone' ||
    method === 'workspace.writeFile' ||
    method === 'workspace.readFile'
  ) {
    return LONG_RPC_TIMEOUT_MS
  }
  // Controller long-poll — waitMs up to 30s + network headroom.
  if (method === 'session.hostActionsPoll') {
    return 45_000
  }
  // Node spawns the harness to read its real model catalog; that probe alone
  // budgets 20s (@superone/claude fetchClaudeModels). A 15s ceiling here would
  // abort the cold call and silently fall back to the stale built-in slug table.
  if (method === 'harness.resources' || method === 'harness.connect') {
    return 40_000
  }
  if (method.startsWith('git.')) {
    return GIT_READ_RPC_TIMEOUT_MS
  }
  return RPC_TIMEOUT_MS
}

/**
 * Authenticated WebSocket RPC client for superone.
 * Lives in Electron Main only — renderer never holds the socket.
 */
export class NodeRpcClient {
  private baseUrl: string
  private ws: NodeSocket | null = null
  private wsSocketId = 0
  private nextSocketId = 1
  /** Socket mid-handshake; not yet promoted to `ws`. Closed by `close()`. */
  private connectingWs: NodeSocket | null = null
  /** The promoted socket's protocol connection: its requests, streams and detail. */
  private conn: RpcConnection | null = null
  private closed = false
  private connectPromise: Promise<void> | null = null
  private connectGeneration = 0
  /** Reject the in-flight connect immediately from `close()`. */
  private connectFail: ((err: Error) => void) | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  /** requestId of a ping still awaiting its pong, per heartbeat tick. */
  private pendingPingId: string | null = null
  private missedPongs = 0
  private readonly heartbeatIntervalMs: number
  /** Established encrypted channel per socket; absent on plain sockets. */
  private readonly channels = new WeakMap<NodeSocket, ChannelState>()
  private dial: NodeSocketDialer | undefined

  constructor(private readonly opts: NodeRpcClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '')
    this.dial = opts.dial
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Update the HTTP/WS base URL while idle. Used after SSH tunnel rebuild so
   * retries target the fresh loopback port.
   */
  setBaseUrl(baseUrl: string): void {
    if (this.ws || this.connectingWs || this.connectPromise) {
      throw new Error('cannot setBaseUrl while connected or connecting')
    }
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  /** Switch route (LAN, Tailscale, relay) while idle; same rule as `setBaseUrl`. */
  setRoute(route: NodeRoute): void {
    this.setBaseUrl(route.baseUrl)
    this.dial = route.dial
  }

  /**
   * Drop a half-open promoted socket without permanently closing the client.
   * Used when a health probe fails while readyState is still OPEN so the next
   * supervisor dial is not stuck on a dead transport.
   * Does not fire onUnexpectedDisconnect (listeners removed first).
   */
  invalidateTransport(_reason?: string): void {
    if (this.closed) return
    this.dropCurrentSocket()
    // Also cancel an in-flight handshake so setBaseUrl/reconnect can proceed.
    const cancelConnect = this.connectFail
    this.connectFail = null
    this.connectGeneration += 1
    this.connectPromise = null
    if (cancelConnect) {
      cancelConnect(transportError('transport invalidated'))
    }
    const connecting = this.connectingWs
    this.connectingWs = null
    if (connecting) {
      try {
        connecting.removeAllListeners()
        connecting.close()
      } catch {
        /* ignore */
      }
    }
  }

  async connect(): Promise<void> {
    if (this.closed) throw transportError('client closed')
    if (this.connected) return
    if (this.connectPromise) return this.connectPromise

    const generation = this.connectGeneration
    this.connectPromise = this.doConnect(generation).finally(() => {
      this.connectPromise = null
    })
    return this.connectPromise
  }

  private async doConnect(generation: number): Promise<void> {
    if (this.closed || generation !== this.connectGeneration) {
      throw transportError('client closed')
    }
    const ticket = await this.opts.getWsTicket()
    if (this.closed || generation !== this.connectGeneration) {
      throw transportError('client closed')
    }
    const ticketId = ticket.split('.')[0] || ticket
    const sig = signWithDeviceKey(this.opts.devicePrivateKeyPem, ticketId)
    const wsBase = this.baseUrl.replace(/^http/, 'ws')
    const url = `${wsBase}/ws`

    await new Promise<void>((resolve, reject) => {
      if (this.closed || generation !== this.connectGeneration) {
        reject(transportError('client closed'))
        return
      }
      let settled = false
      const channel = this.opts.channel
      if (this.dial && !channel) {
        reject(rpcResponseError('invalid_config', 'a relayed route needs the encrypted channel'))
        return
      }
      const ws: NodeSocket = channel
        ? (this.dial ?? dialWebSocket)(url)
        : new WebSocket(url, {
            headers: {
              'x-superone-ws-ticket': ticket,
              'x-superone-ws-proof': ticketId,
              'x-superone-ws-sig': sig,
            },
          })
      this.connectingWs = ws

      let timer: ReturnType<typeof setTimeout> | null = null
      const fail = (err: Error) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        timer = null
        if (this.connectFail === fail) this.connectFail = null
        if (this.connectingWs === ws) this.connectingWs = null
        try {
          ws.removeAllListeners()
          ws.close()
        } catch {
          /* ignore */
        }
        if (this.ws === ws) {
          this.ws = null
          this.wsSocketId = 0
        }
        reject(err)
      }

      this.connectFail = fail
      timer = setTimeout(() => fail(transportError('handshake timeout')), HANDSHAKE_TIMEOUT_MS)

      ws.on('error', (err) =>
        fail(transportError(err instanceof Error ? err.message : String(err))),
      )
      ws.on('close', () => {
        if (!settled) fail(transportError('websocket closed during handshake'))
      })

      const startProtocolHandshake = () => {
        const requestId = randomUUID()
        const onHs = (raw: WebSocket.RawData) => {
          try {
            const msg = this.decodeFrame(ws, raw) as {
              requestId?: string
              type?: string
              error?: { code?: string; message?: string }
            } | undefined
            if (msg?.requestId !== requestId) return
            if (timer) clearTimeout(timer)
            timer = null
            ws.off('message', onHs)
            if (msg.type === 'rpc_error' || msg.type !== 'handshake_ok') {
              // Preserve server code so supervisor can block (e.g. protocol_incompatible).
              fail(
                rpcResponseError(
                  msg.error?.code || 'protocol_incompatible',
                  msg.error?.message || 'handshake failed',
                ),
              )
              return
            }
            // Only promote socket after successful negotiation and if still current.
            if (this.closed || generation !== this.connectGeneration) {
              fail(transportError('client closed'))
              return
            }
            this.connectingWs = null
            if (this.connectFail === fail) this.connectFail = null
            const state = this.channels.get(ws)
            if (state) state.framing = true
            const socketId = this.nextSocketId++
            this.ws = ws
            this.wsSocketId = socketId
            const conn = new RpcConnection((message) => {
              try {
                this.sendFrame(ws, message)
              } catch (err) {
                throw transportError(err instanceof Error ? err.message : String(err))
              }
            }, {
              protocolVersion: PROTOCOL_GENERATION.current,
              newId: randomUUID,
              responseError: (error) => rpcResponseError(error.code, error.message, error.details),
              timeoutError: (method) => transportError(`rpc timeout: ${method}`),
              coalesces: (method) => COALESCED_READS.has(method),
            })
            this.conn = conn
            ws.on('message', (data) => {
              let msg: unknown
              try {
                msg = this.decodeFrame(ws, data)
              } catch (err) {
                // A frame that fails channel authentication means the stream is
                // no longer trustworthy; a malformed plain frame is ignored.
                if (this.channels.has(ws)) {
                  this.reportTransportDead(err instanceof Error ? err.message : String(err), socketId)
                }
                return
              }
              if (msg !== undefined) this.onMessage(conn, msg)
            })
            ws.on('close', () => {
              // Intentional drop/close remove listeners first — only unexpected
              // close of the current promoted socket reaches here.
              const wasCurrent = this.ws === ws
              if (wasCurrent) {
                this.ws = null
                this.wsSocketId = 0
                this.conn = null
                this.stopHeartbeat()
              }
              // Only this socket's requests — never a replacement socket's.
              conn.close(transportError('websocket closed'))
              if (wasCurrent && !this.closed) {
                this.opts.onUnexpectedDisconnect?.('websocket closed')
              }
            })
            this.startHeartbeat()
            settled = true
            resolve()
          } catch (err) {
            fail(transportError(err instanceof Error ? err.message : String(err)))
          }
        }
        ws.on('message', onHs)
        this.sendFrame(ws, {
          type: 'handshake',
          requestId,
          payload: {
            protocol: { ...PROTOCOL_GENERATION },
            databaseSchema: { ...DATABASE_SCHEMA_GENERATION },
          },
        })
      }

      ws.on('open', () => {
        if (this.closed || generation !== this.connectGeneration) {
          fail(transportError('client closed'))
          return
        }
        if (!channel) {
          startProtocolHandshake()
          return
        }
        void this.attachThroughChannel(ws, channel, { ticket, ticketId, sig }).then(
          () => {
            if (settled) return
            if (this.closed || generation !== this.connectGeneration) {
              fail(transportError('client closed'))
              return
            }
            startProtocolHandshake()
          },
          (err: Error) => fail(err),
        )
      })
    })
  }

  /**
   * @param commandKey Stable idempotency key for the logical mutation.
   *        When omitted for mutating methods, a key is minted once for this call
   *        and retained across internal transport reconnect/resend attempts.
   */
  async rpc<T = unknown>(
    method: string,
    payload: unknown = {},
    environmentId?: string,
    commandKey?: string,
  ): Promise<T> {
    if (this.closed) {
      throw transportError('client closed')
    }
    const envId = environmentId ?? this.opts.expectedEnvironmentId
    if (!envId) {
      throw rpcResponseError('invalid_argument', 'environmentId required')
    }
    const isMutating = isNodeMutatingCall(method, payload)
    // One key for the whole logical invocation, including transport retries.
    const idempotencyKey = isMutating ? commandKey || randomUUID() : undefined

    // Supervised clients let ConnectionSupervisor own dial/backoff — never self-reconnect.
    if (this.opts.supervised) {
      if (this.closed) {
        throw transportError('client closed')
      }
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw transportError('not connected')
      }
      return this.sendOnce<T>(method, payload, envId, idempotencyKey)
    }

    let lastError: Error | null = null
    for (let attempt = 0; attempt < TRANSPORT_RETRY_ATTEMPTS; attempt++) {
      try {
        if (this.closed) {
          throw transportError('client closed')
        }
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          await this.connect()
        }
        return await this.sendOnce<T>(method, payload, envId, idempotencyKey)
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        // A dispatched App tool may have run even when its reply was lost.
        // Resending without a confirmed outcome could execute it twice.
        if (this.closed || attempt + 1 >= TRANSPORT_RETRY_ATTEMPTS || method === 'mcpApps.provider' || !isTransportError(lastError)) {
          throw lastError
        }
        // Drop dead socket so the next attempt reconnects; keep idempotencyKey.
        // Pending on the old socket are rejected by its close handler (socket-scoped).
        this.dropCurrentSocket()
      }
    }
    throw lastError ?? transportError(`rpc failed: ${method}`)
  }

  private dropCurrentSocket(): void {
    const old = this.ws
    const oldConn = this.conn
    this.ws = null
    this.wsSocketId = 0
    this.conn = null
    this.stopHeartbeat()
    oldConn?.close(transportError('websocket closed'))
    if (old) {
      try {
        old.removeAllListeners()
        old.close()
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Tear down a socket that is provably dead even though it never emitted
   * `close` (half-open tunnel), and hand recovery to the supervisor.
   * No-op when `socketId` is no longer the promoted socket.
   */
  private reportTransportDead(reason: string, socketId: number): void {
    if (this.closed) return
    if (!socketId || socketId !== this.wsSocketId) return
    this.dropCurrentSocket()
    this.opts.onUnexpectedDisconnect?.(reason)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    if (this.heartbeatIntervalMs <= 0) return
    this.pendingPingId = null
    this.missedPongs = 0
    this.heartbeatTimer = setInterval(() => this.heartbeatTick(), this.heartbeatIntervalMs)
    // Never hold the event loop open for a keepalive.
    this.heartbeatTimer.unref?.()
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    this.pendingPingId = null
    this.missedPongs = 0
  }

  private heartbeatTick(): void {
    const ws = this.ws
    const socketId = this.wsSocketId
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    if (this.pendingPingId) {
      this.missedPongs += 1
      if (this.missedPongs >= HEARTBEAT_MAX_MISSED) {
        this.reportTransportDead(
          `heartbeat timeout after ${this.missedPongs} missed pongs`,
          socketId,
        )
        return
      }
    }

    const requestId = randomUUID()
    this.pendingPingId = requestId
    try {
      this.sendFrame(ws, { type: 'ping', requestId })
    } catch (err) {
      this.reportTransportDead(
        `heartbeat send failed: ${err instanceof Error ? err.message : String(err)}`,
        socketId,
      )
    }
  }

  private sendOnce<T>(
    method: string,
    payload: unknown,
    envId: string,
    idempotencyKey: string | undefined,
  ): Promise<T> {
    const conn = this.conn
    if (!conn || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw transportError('not connected')
    }
    const socketId = this.wsSocketId
    return conn.request<T>(method, payload, {
      environmentId: envId,
      idempotencyKey,
      timeoutMs: rpcTimeoutMs(method),
      // A silent timeout on the live socket means the transport is gone even
      // though no `close` arrived (dead SSH tunnel). Escalate so the supervisor
      // reconnects instead of leaving every later send to time out too.
      onTimeout: () => this.reportTransportDead(`rpc timeout: ${method}`, socketId),
    })
  }

  /**
   * Push the node's topic events after `afterSequence` (`topic.subscribe`). The
   * stream is bound to the current socket and ends with it; the caller
   * resubscribes from the last frame's `sequence`. Returns the unsubscribe.
   */
  async subscribeEvents(
    input: Omit<TopicSubscribeInput, 'subscriptionId'>,
    handlers: RpcStreamHandlers,
  ): Promise<TopicStream> {
    if (this.closed) throw transportError('client closed')
    const envId = this.opts.expectedEnvironmentId
    if (!envId) throw rpcResponseError('invalid_argument', 'environmentId required')
    const conn = this.conn
    if (!conn || !this.ws || this.ws.readyState !== WebSocket.OPEN) throw transportError('not connected')
    const subscriptionId = randomUUID()
    conn.openStream(subscriptionId, handlers)
    try {
      await this.sendOnce('topic.subscribe', { ...input, subscriptionId }, envId, undefined)
    } catch (err) {
      conn.closeStream(subscriptionId)
      throw err
    }
    return {
      close: () => {
        if (!conn.closeStream(subscriptionId)) return
        void this.rpc('topic.unsubscribe', { subscriptionId }).catch(() => {})
      },
      update: async (topics) => {
        // A stream whose socket is gone resubscribes with the current topics.
        if (this.conn !== conn || !conn.hasStream(subscriptionId)) return
        await this.sendOnce('topic.update', { subscriptionId, topics }, envId, undefined)
      },
    }
  }

  /** The link this client dials: a relay slot, or a socket of its own. */
  get tier(): 'relay' | 'lan' {
    return this.dial ? 'relay' : 'lan'
  }

  /**
   * Expand a summarized row of a session this connection loaded: the
   * revision-0 detail now, later packets to `onUpdate` while the socket lives.
   */
  async subscribeDetail(
    input: { sessionId: string; detailRef: string; subscriptionId: string },
    onUpdate: (update: DetailUpdate) => void,
  ): Promise<DetailUpdate> {
    const conn = this.conn
    if (!conn || !this.ws || this.ws.readyState !== WebSocket.OPEN) throw transportError('not connected')
    const envId = this.opts.expectedEnvironmentId
    if (!envId) throw rpcResponseError('invalid_argument', 'environmentId required')
    conn.watchDetail(input.subscriptionId, onUpdate)
    try {
      return await this.sendOnce<DetailUpdate>('session.subscribeDetail', input, envId, undefined)
    } catch (err) {
      conn.unwatchDetail(input.subscriptionId)
      throw err
    }
  }

  async unsubscribeDetail(input: { sessionId: string; subscriptionId: string }): Promise<void> {
    if (!this.conn?.unwatchDetail(input.subscriptionId)) return
    await this.rpc('session.unsubscribeDetail', input).catch(() => {})
  }

  async getDescriptor(): Promise<ExecutionEnvironmentDescriptor> {
    const descriptor = await this.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
    if (
      this.opts.expectedEnvironmentId &&
      descriptor.environmentId !== this.opts.expectedEnvironmentId
    ) {
      throw Object.assign(new Error('environment identity mismatch'), { code: 'identity_conflict' })
    }
    if (
      this.opts.expectedNodePublicKeyFingerprint &&
      descriptor.nodePublicKeyFingerprint &&
      descriptor.nodePublicKeyFingerprint !== this.opts.expectedNodePublicKeyFingerprint
    ) {
      throw Object.assign(new Error('node public key fingerprint mismatch'), {
        code: 'identity_conflict',
      })
    }
    return descriptor
  }

  async health(): Promise<{ ok: boolean; environmentId: string; uptimeMs: number }> {
    return this.rpc('environment.health')
  }

  async systemInfo(): Promise<Record<string, unknown>> {
    return this.rpc('environment.systemInfo')
  }

  async liveStatus(): Promise<EnvironmentLiveStatus> {
    return this.rpc('environment.status')
  }

  async usage(): Promise<EnvironmentUsageReport> {
    return this.rpc('environment.usage')
  }

  async terminalCreate(input: {
    cwd: string
    title?: string
    cols?: number
    rows?: number
  }): Promise<{ terminalId: string }> {
    return this.rpc('terminal.create', input)
  }

  async terminalAttach(terminalId: string): Promise<{ snapshot: string; sequence: string }> {
    return this.rpc('terminal.attach', { terminalId })
  }

  async terminalRead(terminalId: string, afterSequence: string): Promise<TerminalReadResult> {
    return this.rpc('terminal.read', { terminalId, afterSequence })
  }

  async terminalWrite(terminalId: string, data: string, leaseId: string, generation: string): Promise<void> {
    await this.rpc('terminal.write', { terminalId, data, leaseId, generation })
  }

  async terminalResize(
    terminalId: string,
    cols: number,
    rows: number,
    leaseId: string,
    generation: string,
  ): Promise<void> {
    await this.rpc('terminal.resize', { terminalId, cols, rows, leaseId, generation })
  }

  async terminalKill(terminalId: string, leaseId: string, generation: string): Promise<void> {
    await this.rpc('terminal.kill', { terminalId, leaseId, generation })
  }

  async terminalAcquireControl(terminalId: string, ttlMs?: number): Promise<ControlLease> {
    return this.rpc<ControlLease>('terminal.acquireControl', { terminalId, ttlMs })
  }

  close(): void {
    this.closed = true
    this.connectGeneration += 1
    this.stopHeartbeat()
    // Synchronously reject in-flight connect (clears handshake timer via fail()).
    const cancelConnect = this.connectFail
    this.connectFail = null
    if (cancelConnect) {
      cancelConnect(transportError('client closed'))
    }
    this.conn?.close(transportError('client closed'))
    this.conn = null
    const connecting = this.connectingWs
    this.connectingWs = null
    if (connecting) {
      try {
        connecting.removeAllListeners()
        connecting.close()
      } catch {
        /* ignore */
      }
    }
    const open = this.ws
    this.ws = null
    this.wsSocketId = 0
    if (open) {
      try {
        open.removeAllListeners()
        open.close()
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Open the encrypted channel on a fresh socket and attach it to the node
   * session with the ticket and device proof, all inside the channel.
   */
  private async attachThroughChannel(
    ws: NodeSocket,
    credential: ChannelCredential,
    attach: { ticket: string; ticketId: string; sig: string },
  ): Promise<void> {
    let channel: SecureChannel
    try {
      channel = await establishSecureChannel(ws, credential, HANDSHAKE_TIMEOUT_MS)
    } catch (err) {
      const e = err as { code?: string; message?: string }
      // A wrong pairing secret needs user action, not a reconnect loop.
      if (e.code === 'unauthorized') throw rpcResponseError('unauthorized', e.message || 'channel authentication failed')
      throw transportError(e.message || 'encrypted channel failed')
    }
    this.channels.set(ws, {
      channel,
      encoder: new WireEncoder(nodeWireCompression),
      decoder: new WireDecoder(nodeWireCompression),
      framing: false,
    })
    const requestId = randomUUID()
    await new Promise<void>((resolve, reject) => {
      const onAttach = (raw: WebSocket.RawData) => {
        ws.off('message', onAttach)
        try {
          const msg = channel.open(raw as Buffer) as { type?: string; requestId?: string; error?: { code?: string; message?: string } }
          if (msg.type === 'attach_ok' && msg.requestId === requestId) {
            resolve()
            return
          }
          reject(rpcResponseError(msg.error?.code || 'unauthorized', msg.error?.message || 'attach failed'))
        } catch (err) {
          reject(transportError(err instanceof Error ? err.message : String(err)))
        }
      }
      ws.on('message', onAttach)
      this.sendFrame(ws, { type: 'attach', requestId, ticket: attach.ticket, proof: attach.ticketId, sig: attach.sig })
    })
  }

  private sendFrame(ws: NodeSocket, msg: unknown): void {
    const state = this.channels.get(ws)
    if (!state) {
      ws.send(JSON.stringify(msg))
      return
    }
    if (!state.framing) {
      ws.send(state.channel.seal(msg))
      return
    }
    for (const frame of state.encoder.encode(msg)) ws.send(state.channel.sealBytes(frame))
  }

  /**
   * Throws on malformed JSON, and on channel tampering or replay. `undefined`
   * while a fragmented message is still arriving.
   */
  private decodeFrame(ws: NodeSocket, data: WebSocket.RawData): unknown {
    const state = this.channels.get(ws)
    return state ? state.decoder.decode(state.channel.openBytes(data as Buffer)) : JSON.parse(data.toString())
  }

  private onMessage(conn: RpcConnection, raw: unknown): void {
    if ((raw as { type?: unknown } | null)?.type === 'pong') {
      // Any pong proves liveness, even a late one from a previous tick.
      this.pendingPingId = null
      this.missedPongs = 0
      return
    }
    conn.receive(raw)
  }
}

/** Locally generated transport failure — safe to reconnect/resend with same key. */
function transportError(message: string): Error {
  return Object.assign(new Error(message), {
    code: 'unavailable' as const,
    transport: true as const,
  })
}

/** Server-originated RPC/handshake error — never auto-retried. */
function rpcResponseError(code: string, message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), {
    code,
    transport: false as const,
    rpcError: true as const,
    ...(details ? { details } : {}),
  })
}

function isTransportError(err: Error): boolean {
  // Only explicit local transport markers — never server rpc_error by message/code.
  return (err as { transport?: boolean }).transport === true
}
