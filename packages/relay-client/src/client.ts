import type { ReadDesktopFileResponse, RemoteCommand, ShareFilePayload } from '@superone/shared/agent-types'
import { SeqAckTracker } from './ack'
import { EventBuffer } from './buffer'
import { buildLanWsUrl, buildRelayWsUrl, type TransportKind } from './connect'
import { decryptPayload, deriveKeys, encryptPayload } from './crypto'
import { handleInboundFrame, makeDecrypt, type InboundFrame, type RelayControlFrame } from './frames'
import { RpcInbox } from './rpc'
import { uploadBytes, type HttpPut, type UploadBytesOptions } from './attachments'
import { downloadDesktopFileBytes, downloadSharedFileBytes, type HttpGet } from './downloads'

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
export type MobileIdentity = { deviceId: string; deviceName: string }

const defaultOpenSocket: OpenSocket = (url) => new WebSocket(url) as unknown as SocketLike

export class RelayClient {
  private ws: SocketLike | null = null
  private aesKeyBytes: Uint8Array | null = null
  private channelKeyHex: string | null = null
  private readonly tracker = new SeqAckTracker()
  private readonly rpc = new RpcInbox()
  readonly buffer = new EventBuffer()
  private ackTimer: ReturnType<typeof setTimeout> | null = null
  private cancelConnect: (() => void) | null = null
  private kind: TransportKind = 'relay'
  private closed = false
  private last:
    | { kind: 'relay'; relayUrl: string; masterSecret: string; deviceId?: string; deviceName?: string }
    | { kind: 'lan'; host: string; port: number; masterSecret: string; identity?: MobileIdentity }
    | null = null

  constructor(
    private readonly hooks: {
      onEvents?: (events: unknown[], epoch: number) => void
      onTerminal?: (payload: unknown) => void
      onReset?: () => void
      onShutdown?: () => void
      onControl?: (frame: RelayControlFrame) => void
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
    deviceName?: string
  }): Promise<void> {
    const sameRelay = this.last?.kind === 'relay'
      && this.last.relayUrl === opts.relayUrl
      && this.last.masterSecret === opts.masterSecret
      && this.last.deviceId === opts.deviceId
      && this.last.deviceName === opts.deviceName
    if (!sameRelay) this.tracker.clear()
    this.last = { kind: 'relay', ...opts }
    this.kind = 'relay'
    this.closed = false
    const built = await buildRelayWsUrl({
      relayUrl: opts.relayUrl,
      masterSecret: opts.masterSecret,
      role: 'mobile',
      deviceId: opts.deviceId,
    })
    this.channelKeyHex = built.channelKeyHex
    const identity = opts.deviceId
      ? { deviceId: opts.deviceId, deviceName: opts.deviceName ?? 'Mobile' }
      : undefined
    await this.open(built.url, built.aesKeyBytes, true, identity)
  }

  async connectLan(host: string, port: number, masterSecret: string, identity?: MobileIdentity): Promise<void> {
    this.last = { kind: 'lan', host, port, masterSecret, ...(identity ? { identity } : {}) }
    this.kind = 'lan'
    this.closed = false
    const keys = deriveKeys(masterSecret)
    this.channelKeyHex = keys.channelKeyHex
    this.tracker.clear()
    await this.open(buildLanWsUrl(host, port), keys.aesKeyBytes, false, identity)
  }

  disconnect(): void {
    this.closed = true
    this.cancelConnect?.()
    this.cancelConnect = null
    this.clearAckTimer()
    this.rpc.failAll(new Error('disconnected'))
    const ws = this.ws
    this.ws = null
    this.detachAndClose(ws)
    this.tracker.clear()
    this.buffer.stop()
    if (ws) this.hooks.onStatus?.(false)
  }

  request(command: RemoteCommand, timeoutMs = 15_000): Promise<unknown> {
    if (!this.ws || !this.aesKeyBytes) return Promise.reject(new Error('not connected'))
    const ws = this.ws
    return this.rpc.begin(command, (frame) => ws.send(JSON.stringify(frame)), this.aesKeyBytes, timeoutMs)
  }

  uploadFile(
    input: Omit<UploadBytesOptions, 'transport' | 'lanHost' | 'aesKeyBytes' | 'channelKeyHex' | 'request' | 'put'>,
    put: HttpPut,
  ): Promise<string> {
    if (!this.ws || !this.aesKeyBytes || !this.channelKeyHex) return Promise.reject(new Error('not connected'))
    return uploadBytes({
      ...input,
      transport: this.kind,
      lanHost: this.last?.kind === 'lan' ? this.last.host : undefined,
      aesKeyBytes: this.aesKeyBytes,
      channelKeyHex: this.channelKeyHex,
      request: (command, timeoutMs) => this.request(command, timeoutMs),
      put,
    })
  }

  downloadSharedFile(file: ShareFilePayload, get?: HttpGet): Promise<Uint8Array> {
    return downloadSharedFileBytes({
      file,
      aesKeyBytes: this.aesKeyBytes,
      channelKeyHex: this.channelKeyHex,
      ...(get ? { get } : {}),
    })
  }

  downloadDesktopFile(
    file: Extract<ReadDesktopFileResponse, { url: string }>,
    get?: HttpGet,
  ): Promise<Uint8Array> {
    return downloadDesktopFileBytes({
      file,
      transport: this.kind,
      aesKeyBytes: this.aesKeyBytes,
      channelKeyHex: this.channelKeyHex,
      ...(get ? { get } : {}),
    })
  }

  /** Fire-and-forget encrypted command. Terminal I/O uses this — results arrive on the terminal channel. */
  send(command: RemoteCommand): void {
    if (!this.ws || !this.aesKeyBytes) throw new Error('not connected')
    const data = encryptPayload(this.aesKeyBytes, command)
    this.ws.send(JSON.stringify({ type: 'command', data }))
  }

  reconnect(): Promise<void> {
    const last = this.last
    if (!last) return Promise.reject(new Error('never connected'))
    this.buffer.start()
    if (last.kind === 'relay') return this.connectRelay(last)
    return this.connectLan(last.host, last.port, last.masterSecret, last.identity)
  }

  private async open(
    url: string,
    aesKeyBytes: Uint8Array,
    replay: boolean,
    identity?: MobileIdentity,
  ): Promise<void> {
    this.cancelConnect?.()
    this.cancelConnect = null
    this.clearAckTimer()
    this.rpc.failAll(new Error('connection replaced'))
    const previous = this.ws
    this.ws = null
    this.detachAndClose(previous)
    this.closed = false
    this.aesKeyBytes = aesKeyBytes
    const ws = (this.hooks.openSocket ?? defaultOpenSocket)(url)
    this.ws = ws
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finishError = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (this.cancelConnect === cancel) this.cancelConnect = null
        if (this.ws === ws) this.ws = null
        this.detachAndClose(ws)
        reject(error)
      }
      const timer = setTimeout(() => finishError(new Error('ws connect timeout')), 15_000)
      const cancel = () => finishError(new Error('connection cancelled'))
      this.cancelConnect = cancel
      ws.onmessage = (ev) => {
        if (this.ws === ws) this.onRaw(String(ev.data))
      }
      ws.onerror = () => finishError(new Error('ws error'))
      ws.onclose = () => {
        if (!settled) {
          finishError(new Error('ws closed before connect'))
          return
        }
        if (this.ws === ws) {
          this.ws = null
          this.clearAckTimer()
          this.rpc.failAll(new Error('connection closed'))
          this.hooks.onStatus?.(false)
        }
      }
      ws.onopen = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (this.cancelConnect === cancel) this.cancelConnect = null
        resolve()
      }
    })
    if (this.closed || this.ws !== ws) {
      this.detachAndClose(ws)
      return
    }
    if (identity) {
      ws.send(JSON.stringify({
        type: 'register',
        deviceName: identity.deviceName,
        mobileDeviceId: identity.deviceId,
      }))
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
        this.clearAckTimer()
        this.buffer.restart()
        this.hooks.onReset?.()
        return
      case 'desktop_shutdown':
        this.clearAckTimer()
        this.buffer.stop()
        this.hooks.onShutdown?.()
        return
      case 'control':
        this.hooks.onControl?.(effect.frame)
        return
      case 'response':
        this.rpc.complete(effect.requestId, effect.payload)
        return
      case 'response_error':
        this.rpc.fail(effect.requestId, effect.error)
        return
      case 'response_chunk': {
        try {
          const assembled = this.rpc.ingestChunk(effect.requestId, effect.index, effect.total, effect.data)
          if (assembled) {
            this.rpc.complete(effect.requestId, decryptPayload(this.aesKeyBytes, assembled))
          }
        } catch (error) {
          this.rpc.fail(effect.requestId, error)
        }
      }
    }
  }

  private maybeAck(seq: number, flush: boolean): void {
    if (this.kind !== 'relay' || !this.ws || seq <= 0) return
    if (flush) {
      this.sendAck(this.tracker.lastAckedSeq)
      return
    }
    if (this.ackTimer == null) {
      this.ackTimer = setTimeout(() => this.sendAck(this.tracker.lastAckedSeq), 2000)
    }
  }

  private sendAck(seq: number): void {
    this.clearAckTimer()
    const ws = this.ws
    if (!ws) return
    try {
      ws.send(JSON.stringify({ type: 'ack', seq }))
      this.tracker.acknowledgeSent()
    } catch {
      // A closing socket may reject send before onclose schedules reconnect.
    }
  }

  private clearAckTimer(): void {
    if (this.ackTimer) clearTimeout(this.ackTimer)
    this.ackTimer = null
  }

  private detachAndClose(ws: SocketLike | null): void {
    if (!ws) return
    ws.onopen = null
    ws.onmessage = null
    ws.onclose = null
    ws.onerror = null
    ws.close()
  }
}
