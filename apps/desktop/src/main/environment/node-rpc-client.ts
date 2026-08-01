import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import type { ControlLease, ExecutionEnvironmentDescriptor, TerminalReadResult } from '@superone/shared/environment'
import { DATABASE_SCHEMA_GENERATION, PROTOCOL_GENERATION } from '@superone/shared/environment'
import { signWithDeviceKey } from './node-auth-client'

export interface NodeRpcClientOptions {
  /** http(s) base URL, e.g. http://127.0.0.1:7788 */
  baseUrl: string
  /** Obtain a fresh single-use WS ticket. */
  getWsTicket: () => Promise<string>
  /** Device private key PEM for WS proof-of-possession. */
  devicePrivateKeyPem: string
  expectedEnvironmentId?: string
  expectedNodePublicKeyFingerprint?: string
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  /** Socket that sent this request — stale close events must not touch other sockets. */
  socketId: number
}

const RPC_TIMEOUT_MS = 15_000
/** Long-running git / large file RPCs (worktree, clone, handoff, bulk fs). */
const LONG_RPC_TIMEOUT_MS = 300_000
const HANDSHAKE_TIMEOUT_MS = 10_000
/** One reconnect+resend after transport loss within a single rpc() call. */
const TRANSPORT_RETRY_ATTEMPTS = 2

function rpcTimeoutMs(method: string): number {
  if (
    method.startsWith('git.') ||
    method === 'project.clone' ||
    method === 'workspace.writeFile' ||
    method === 'workspace.readFile'
  ) {
    return LONG_RPC_TIMEOUT_MS
  }
  return RPC_TIMEOUT_MS
}

/**
 * Authenticated WebSocket RPC client for superone.
 * Lives in Electron Main only — renderer never holds the socket.
 */
export class NodeRpcClient {
  private ws: WebSocket | null = null
  private wsSocketId = 0
  private nextSocketId = 1
  /** Socket mid-handshake; not yet promoted to `ws`. Closed by `close()`. */
  private connectingWs: WebSocket | null = null
  private pending = new Map<string, Pending>()
  private closed = false
  private connectPromise: Promise<void> | null = null
  private connectGeneration = 0
  /** Reject the in-flight connect immediately from `close()`. */
  private connectFail: ((err: Error) => void) | null = null

  constructor(private readonly opts: NodeRpcClientOptions) {}

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
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
    const base = this.opts.baseUrl.replace(/\/$/, '')
    const wsBase = base.replace(/^http/, 'ws')
    const url = `${wsBase}/ws`

    await new Promise<void>((resolve, reject) => {
      if (this.closed || generation !== this.connectGeneration) {
        reject(transportError('client closed'))
        return
      }
      let settled = false
      const ws = new WebSocket(url, {
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

      ws.on('open', () => {
        if (this.closed || generation !== this.connectGeneration) {
          fail(transportError('client closed'))
          return
        }
        const requestId = randomUUID()
        const onHs = (raw: WebSocket.RawData) => {
          try {
            const msg = JSON.parse(raw.toString()) as {
              requestId?: string
              type?: string
              error?: { code?: string; message?: string }
            }
            if (msg.requestId !== requestId) return
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
            const socketId = this.nextSocketId++
            this.ws = ws
            this.wsSocketId = socketId
            ws.on('message', (data) => this.onMessage(data.toString()))
            ws.on('close', () => {
              if (this.ws === ws) {
                this.ws = null
                this.wsSocketId = 0
              }
              // Only reject requests sent on THIS socket — never a replacement socket.
              this.rejectPendingForSocket(socketId, transportError('websocket closed'))
            })
            settled = true
            resolve()
          } catch (err) {
            fail(transportError(err instanceof Error ? err.message : String(err)))
          }
        }
        ws.on('message', onHs)
        ws.send(
          JSON.stringify({
            type: 'handshake',
            requestId,
            payload: {
              protocol: { ...PROTOCOL_GENERATION },
              databaseSchema: { ...DATABASE_SCHEMA_GENERATION },
            },
          }),
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
    const isMutating = isMutatingMethod(method)
    // One key for the whole logical invocation, including transport retries.
    const idempotencyKey = isMutating ? commandKey || randomUUID() : undefined

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
        if (this.closed || attempt + 1 >= TRANSPORT_RETRY_ATTEMPTS || !isTransportError(lastError)) {
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
    const oldId = this.wsSocketId
    this.ws = null
    this.wsSocketId = 0
    if (oldId) {
      this.rejectPendingForSocket(oldId, transportError('websocket closed'))
    }
    if (old) {
      try {
        old.removeAllListeners()
        old.close()
      } catch {
        /* ignore */
      }
    }
  }

  private sendOnce<T>(
    method: string,
    payload: unknown,
    envId: string,
    idempotencyKey: string | undefined,
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw transportError('not connected')
    }
    const socketId = this.wsSocketId
    const requestId = randomUUID()
    const message = {
      type: 'rpc',
      requestId,
      method,
      payload,
      environmentId: envId,
      protocolVersion: PROTOCOL_GENERATION.current,
      idempotencyKey,
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(transportError(`rpc timeout: ${method}`))
      }, rpcTimeoutMs(method))
      this.pending.set(requestId, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
        socketId,
      })
      try {
        this.ws!.send(JSON.stringify(message))
      } catch (err) {
        this.pending.delete(requestId)
        clearTimeout(timer)
        reject(transportError(err instanceof Error ? err.message : String(err)))
      }
    })
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
    // Synchronously reject in-flight connect (clears handshake timer via fail()).
    const cancelConnect = this.connectFail
    this.connectFail = null
    if (cancelConnect) {
      cancelConnect(transportError('client closed'))
    }
    this.rejectAll(transportError('client closed'))
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

  private onMessage(raw: string): void {
    let msg: {
      type: string
      requestId?: string
      result?: unknown
      error?: { code: string; message: string }
    }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (!msg.requestId) return
    const pending = this.pending.get(msg.requestId)
    if (!pending) return
    this.pending.delete(msg.requestId)
    clearTimeout(pending.timer)
    if (msg.type === 'rpc_error') {
      // Server application/protocol errors — never classified as transport.
      pending.reject(rpcResponseError(msg.error?.code || 'internal', msg.error?.message || 'rpc error'))
    } else {
      pending.resolve(msg.result)
    }
  }

  private rejectPendingForSocket(socketId: number, err: Error): void {
    for (const [id, p] of this.pending) {
      if (p.socketId !== socketId) continue
      clearTimeout(p.timer)
      p.reject(err)
      this.pending.delete(id)
    }
  }

  private rejectAll(err: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
      this.pending.delete(id)
    }
  }
}

function isMutatingMethod(method: string): boolean {
  return (
    method.includes('.create') ||
    method.includes('.write') ||
    method.includes('.send') ||
    method.includes('.kill') ||
    method.includes('.resize') ||
    method.includes('.open') ||
    method.includes('.remove') ||
    method.includes('.rename') ||
    method.includes('.move') ||
    method.includes('.delete') ||
    method.includes('.mkdir') ||
    method.includes('setUiFlags') ||
    method.includes('.interrupt') ||
    method.includes('.respond') ||
    method.includes('.acquire') ||
    method.includes('.renew') ||
    method.includes('.release') ||
    method.includes('.close') ||
    method.includes('watchStart') ||
    method.includes('watchStop') ||
    method.startsWith('collaboration.send') ||
    // Git mutations: must not transport-retry without idempotency key
    method === 'git.clone' ||
    method === 'git.switchBranch' ||
    method === 'git.createBranch' ||
    method === 'git.worktreeActivate' ||
    method === 'git.worktreeAssignBranch' ||
    method === 'git.worktreeHandoff' ||
    method.includes('setCwd') ||
    method.includes('session.set')
  )
}

/** Locally generated transport failure — safe to reconnect/resend with same key. */
function transportError(message: string): Error {
  return Object.assign(new Error(message), {
    code: 'unavailable' as const,
    transport: true as const,
  })
}

/** Server-originated RPC/handshake error — never auto-retried. */
function rpcResponseError(code: string, message: string): Error {
  return Object.assign(new Error(message), {
    code,
    transport: false as const,
    rpcError: true as const,
  })
}

function isTransportError(err: Error): boolean {
  // Only explicit local transport markers — never server rpc_error by message/code.
  return (err as { transport?: boolean }).transport === true
}
