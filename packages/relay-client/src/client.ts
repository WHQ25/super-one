import type { RemoteCommand } from '@superone/shared/agent-types'
import { SeqAckTracker } from './ack'
import { EventBuffer } from './buffer'
import { buildLanWsUrl, buildRelayWsUrl, type TransportKind } from './connect'
import { decryptPayload, deriveKeys } from './crypto'
import { handleInboundFrame, makeDecrypt, type InboundFrame } from './frames'
import { RpcInbox } from './rpc'

export type SocketLike = {
  send(data: string): void
  close(): void
  addEventListener?(type: string, fn: (ev: { data?: string }) => void): void
  onopen: ((ev?: unknown) => void) | null
  onmessage: ((ev: { data: string }) => void) | null
  onclose: ((ev?: unknown) => void) | null
  onerror: ((ev?: unknown) => void) | null
}

export type OpenSocket = (url: string) => SocketLike

const defaultOpenSocket: OpenSocket = (url) => new WebSocket(url) as unknown as SocketLike

export class RelayClient {
  private ws: SocketLike | null = null
  private aesKeyBytes: Uint8Array | null = null
  private readonly tracker = new SeqAckTracker()
  private readonly rpc = new RpcInbox()
  readonly buffer = new EventBuffer()
  private ackTimer: ReturnType<typeof setTimeout> | null = null
  private kind: TransportKind = 'relay'
  private closed = false

  constructor(
    private readonly hooks: {
      onEvents?: (events: unknown[], epoch: number) => void
      onTerminal?: (payload: unknown) => void
      onReset?: () => void
      onShutdown?: () => void
      onStatus?: (connected: boolean) => void
      openSocket?: OpenSocket
    } = {},
  ) {}

  get transport(): TransportKind {
    return this.kind
  }

  get connected(): boolean {
    return this.ws != null
  }

  get lastAckedSeq(): number {
    return this.tracker.lastAckedSeq
  }

  startBuffering(): void {
    this.buffer.start()
  }

  releaseBuffer(): { epoch: number; batches: unknown[][] } {
    return this.buffer.release()
  }

  async connectRelay(opts: {
    relayUrl: string
    masterSecret: string
    deviceId?: string
  }): Promise<void> {
    this.kind = 'relay'
    const built = await buildRelayWsUrl({
      relayUrl: opts.relayUrl,
      masterSecret: opts.masterSecret,
      role: 'mobile',
      deviceId: opts.deviceId,
    })
    await this.open(built.url, built.aesKeyBytes, true)
  }

  async connectLan(host: string, port: number, masterSecret: string): Promise<void> {
    this.kind = 'lan'
    const keys = deriveKeys(masterSecret)
    this.tracker.clear()
    await this.open(buildLanWsUrl(host, port), keys.aesKeyBytes, false)
  }

  disconnect(): void {
    this.closed = true
    this.clearAckTimer()
    this.rpc.failAll(new Error('disconnected'))
    this.ws?.close()
    this.ws = null
    this.hooks.onStatus?.(false)
  }

  request(command: RemoteCommand): Promise<unknown> {
    if (!this.ws || !this.aesKeyBytes) return Promise.reject(new Error('not connected'))
    const ws = this.ws
    return this.rpc.begin(command, (frame) => ws.send(JSON.stringify(frame)), this.aesKeyBytes)
  }

  private async open(url: string, aesKeyBytes: Uint8Array, replay: boolean): Promise<void> {
    this.disconnect()
    this.closed = false
    this.aesKeyBytes = aesKeyBytes
    const ws = (this.hooks.openSocket ?? defaultOpenSocket)(url)
    this.ws = ws
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ws connect timeout')), 15_000)
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error('ws error'))
      }
      ws.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
    })
    if (this.closed) {
      ws.close()
      return
    }
    ws.onmessage = (ev) => this.onRaw(String(ev.data))
    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null
        this.hooks.onStatus?.(false)
      }
    }
    this.hooks.onStatus?.(true)
    if (replay) {
      const fromSeq = this.tracker.lastAckedSeq + 1
      ws.send(JSON.stringify({ type: 'replay', fromSeq }))
    }
  }

  private onRaw(raw: string): void {
    let frame: InboundFrame
    try {
      frame = JSON.parse(raw) as InboundFrame
    } catch {
      return
    }
    if (!this.aesKeyBytes) return
    const decrypt = makeDecrypt(this.aesKeyBytes)
    const effect = handleInboundFrame(frame, this.tracker, decrypt)
    switch (effect.kind) {
      case 'drop':
      case 'pong':
        return
      case 'ack':
        this.maybeAck(effect.seq, effect.flush)
        return
      case 'events':
        this.maybeAck(effect.ack.seq, effect.ack.flush)
        if (this.buffer.isBuffering) this.buffer.push(effect.events)
        else this.hooks.onEvents?.(effect.events, this.buffer.epoch)
        return
      case 'terminal':
        this.hooks.onTerminal?.(effect.payload)
        return
      case 'reset':
        this.hooks.onReset?.()
        return
      case 'desktop_shutdown':
        this.hooks.onShutdown?.()
        return
      case 'response':
        this.rpc.complete(effect.requestId, effect.payload)
        return
      case 'response_chunk': {
        const assembled = this.rpc.ingestChunk(effect.requestId, effect.index, effect.total, effect.data)
        if (assembled) {
          try {
            this.rpc.complete(effect.requestId, decryptPayload(this.aesKeyBytes, assembled))
          } catch (e) {
            this.rpc.complete(effect.requestId, { error: String(e) })
          }
        }
      }
    }
  }

  private maybeAck(seq: number, flush: boolean): void {
    if (this.kind !== 'relay' || !this.ws || seq <= 0) return
    if (flush) {
      this.sendAck(seq)
      return
    }
    this.clearAckTimer()
    this.ackTimer = setTimeout(() => this.sendAck(seq), 2000)
  }

  private sendAck(seq: number): void {
    this.clearAckTimer()
    this.ws?.send(JSON.stringify({ type: 'ack', seq }))
  }

  private clearAckTimer(): void {
    if (this.ackTimer) clearTimeout(this.ackTimer)
    this.ackTimer = null
  }
}
