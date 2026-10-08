import { RequestCoalescer } from './request-coalescer'
import { jsonBytes, type TransportMetric } from './transport-ledger'
import type { ReadDesktopFileResponse, RemoteCommand } from '@superone/shared/agent-types'
import { SeqAckTracker } from './ack'
import { EventBuffer } from './buffer'
import { buildLanWsUrl, buildRelayWsUrl, type TransportKind } from './connect'
import { deriveKeys } from './crypto'
import { handleInboundFrame, type FrameDecrypt, type InboundFrame, type RelayControlFrame } from './frames'
import { decodeHostPlaintext } from './host-payload'
import { LINK_CHANNEL_FRAME, openLinkFrame, sealLinkFrame } from './phone-link'
import { SecureChannel, SecureChannelError, startClientHandshake, type ChannelCredential } from './secure-channel'
import { createRelayHeartbeat, RELAY_PING, RELAY_PONG, type RelayHeartbeat } from '@superone/shared/relay-heartbeat'
import { RpcInbox } from './rpc'
import { uploadBytes, type HttpPut, type UploadBytesOptions } from './attachments'
import { downloadDesktopFileBytes, type DownloadProgress, type HttpGet } from './downloads'

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

/** What a phone holds for one paired host; the secret never crosses the network. */
export type HostLink = { credential: ChannelCredential; roomId: string }

type ChannelReady = { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void }

function channelReady(): ChannelReady {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  // A connection nobody asked anything of must not surface an unhandled rejection.
  promise.catch(() => {})
  return { promise, resolve, reject }
}

const encoder = new TextEncoder()

const defaultOpenSocket: OpenSocket = (url) => new WebSocket(url) as unknown as SocketLike

export class RelayClient {
  private ws: SocketLike | null = null
  private credential: ChannelCredential | null = null
  /** Static per-pairing keys for relay-staged files; frames use the channel. */
  private fileKeys: { aesKeyBytes: Uint8Array; channelKeyHex: string } | null = null
  private channel: SecureChannel | null = null
  private handshake: { nonce: string; finish: ReturnType<typeof startClientHandshake>['finish'] } | null = null
  private ready: ChannelReady = channelReady()
  private readonly tracker = new SeqAckTracker()
  private readonly rpc = new RpcInbox()
  private readonly reads = new RequestCoalescer()
  readonly buffer = new EventBuffer()
  private ackTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeat: RelayHeartbeat | null = null
  private probe: { promise: Promise<boolean>; finish: (ok: boolean) => void } | null = null
  private cancelConnect: (() => void) | null = null
  private kind: TransportKind = 'relay'
  private closed = false
  private last:
    | { kind: 'relay'; relayUrl: string; link: HostLink; deviceId: string }
    | { kind: 'lan'; host: string; port: number; link: HostLink }
    | null = null

  constructor(
    private readonly hooks: {
      onMetric?: (metric: TransportMetric) => void
      onEvents?: (events: unknown[], epoch: number) => void
      /**
       * Every event batch as it arrives, including those a session restore is
       * holding back. For consumers outside the session's epoch order (workspace
       * invalidations, activity), which a buffered batch would otherwise never reach.
       */
      onArrived?: (events: unknown[]) => void
      onTerminal?: (payload: unknown) => void
      onReset?: () => void
      onShutdown?: () => void
      onControl?: (frame: RelayControlFrame) => void
      onStatus?: (connected: boolean) => void
      openSocket?: OpenSocket
      /** Test seam only; production keeps the shared relay heartbeat cadence. */
      heartbeat?: { intervalMs: number; timeoutMs: number }
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

  /**
   * The relay slot is keyed by `deviceId`; the host checks it against the
   * device bound to the credential. The desktop may be away: the handshake then
   * runs when the relay announces it (`peer_connected`).
   */
  async connectRelay(opts: { relayUrl: string; link: HostLink; deviceId: string }): Promise<void> {
    this.last = { kind: 'relay', ...opts }
    this.kind = 'relay'
    this.closed = false
    await this.open(buildRelayWsUrl({ relayUrl: opts.relayUrl, roomId: opts.link.roomId, role: 'mobile', deviceId: opts.deviceId }), opts.link)
  }

  async connectLan(host: string, port: number, link: HostLink): Promise<void> {
    this.last = { kind: 'lan', host, port, link }
    this.kind = 'lan'
    this.closed = false
    await this.open(buildLanWsUrl(host, port), link)
  }

  disconnect(): void {
    this.closed = true
    this.cancelConnect?.()
    this.cancelConnect = null
    this.clearAckTimer()
    this.probe?.finish(false)
    this.stopHeartbeat()
    this.reads.clear()
    this.rpc.failAll(new Error('disconnected'))
    const ws = this.ws
    this.ws = null
    this.detachAndClose(ws)
    this.resetChannel(new Error('disconnected'))
    this.tracker.clear()
    this.buffer.stop()
    if (ws) this.hooks.onStatus?.(false)
  }

  request(command: RemoteCommand, timeoutMs = 15_000): Promise<unknown> {
    if (!this.ws) return Promise.reject(new Error('not connected'))
    const ws = this.ws
    const result = this.reads.run(command, timeoutMs, async () => {
      const started = performance.now()
      await this.whenChannelReady(ws, timeoutMs, command.type)
      const encoding = performance.now()
      const pending = this.rpc.begin(command, payload => this.sendCommand(ws, payload), Math.max(1, timeoutMs - (encoding - started)))
      this.metric({ kind: 'encode', name: command.type, durationMs: performance.now() - encoding, bytes: this.hooks.onMetric ? jsonBytes(command) : 0 })
      if (this.hooks.onMetric) {
        const record = () => this.metric({ kind: 'rpc', name: command.type, durationMs: performance.now() - started })
        void pending.then(record, record)
      }
      return pending
    })
    return result
  }

  uploadFile(
    input: Omit<UploadBytesOptions, 'transport' | 'lanHost' | 'aesKeyBytes' | 'channelKeyHex' | 'request' | 'put'>,
    put: HttpPut,
  ): Promise<string> {
    if (!this.ws || !this.fileKeys) return Promise.reject(new Error('not connected'))
    return uploadBytes({
      ...input,
      transport: this.kind,
      lanHost: this.last?.kind === 'lan' ? this.last.host : undefined,
      aesKeyBytes: this.fileKeys.aesKeyBytes,
      channelKeyHex: this.fileKeys.channelKeyHex,
      request: (command, timeoutMs) => this.request(command, timeoutMs),
      put,
    })
  }

  downloadDesktopFile(
    file: Extract<ReadDesktopFileResponse, { url: string }>,
    get?: HttpGet,
    onProgress?: DownloadProgress,
  ): Promise<Uint8Array> {
    return downloadDesktopFileBytes({
      file,
      transport: this.kind,
      lanHost: this.last?.kind === 'lan' ? this.last.host : undefined,
      aesKeyBytes: this.fileKeys?.aesKeyBytes ?? null,
      channelKeyHex: this.fileKeys?.channelKeyHex ?? null,
      ...(get ? { get } : {}),
      ...(onProgress ? { onProgress } : {}),
    })
  }

  /**
   * Fire-and-forget encrypted command. Terminal I/O uses this — results arrive
   * on the terminal channel. Before the channel is up it waits for it, in order.
   */
  send(command: RemoteCommand): void {
    const ws = this.ws
    if (!ws) throw new Error('not connected')
    const deliver = () => {
      const started = performance.now()
      this.sendCommand(ws, command)
      this.metric({ kind: 'encode', name: command.type, durationMs: performance.now() - started, bytes: this.hooks.onMetric ? jsonBytes(command) : 0 })
    }
    if (this.channel && this.handshake === null) {
      deliver()
      return
    }
    void this.ready.promise.then(() => { if (this.ws === ws) deliver() }, () => {})
  }

  private sendCommand(ws: SocketLike, command: unknown): void {
    const channel = this.channel
    if (this.ws !== ws || !channel) throw new Error('not connected')
    const data = sealLinkFrame(channel, { t: 'command' }, encoder.encode(JSON.stringify(command)))
    this.sendFrame(ws, JSON.stringify({ type: 'command', data }))
  }

  /** Resolves once the host has proven the pairing secret on this socket. */
  private whenChannelReady(ws: SocketLike, timeoutMs: number, name: string): Promise<void> {
    if (this.ws !== ws) return Promise.reject(new Error('connection replaced'))
    if (this.channel && this.handshake === null) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`rpc timeout: ${name}`)), timeoutMs)
      this.ready.promise.then(
        () => { clearTimeout(timer); resolve() },
        (error: Error) => { clearTimeout(timer); reject(error) },
      )
    })
  }

  /** Forget the channel of the current socket; waiters fail with `error` and a new wait begins. */
  private resetChannel(error: Error): void {
    this.channel = null
    this.handshake = null
    this.ready.reject(error)
    this.ready = channelReady()
  }

  private startHandshake(ws: SocketLike): void {
    if (!this.credential || this.ws !== ws) return
    this.resetChannel(new Error('channel restarted'))
    const hs = startClientHandshake(this.credential)
    this.handshake = { nonce: hs.hello.nonce, finish: hs.finish }
    this.sendFrame(ws, JSON.stringify({ type: LINK_CHANNEL_FRAME, msg: hs.hello }))
  }

  private onChannelFrame(ws: SocketLike, frame: { msg?: unknown; hello?: unknown; data?: unknown }): void {
    if (frame.msg !== undefined) {
      // A challenge answers one hello; an older hello's challenge is stale.
      const hs = this.handshake
      if (!hs || frame.hello !== hs.nonce) return
      try {
        const { proof, channel } = hs.finish(frame.msg)
        this.channel = channel
        this.sendFrame(ws, JSON.stringify({ type: LINK_CHANNEL_FRAME, msg: proof }))
      } catch (error) {
        // The host could not prove the secret: not our host. Drop the socket.
        this.handleClosed(ws, error instanceof Error ? error : new Error('channel handshake failed'))
      }
      return
    }
    if (typeof frame.data !== 'string' || !this.channel || !this.handshake) return
    try {
      const { header } = openLinkFrame(this.channel, frame.data)
      if (header.t !== 'handshake') throw new SecureChannelError('channel_protocol', 'expected handshake')
      this.handshake = null
      this.ready.resolve()
      this.hooks.onControl?.({ type: 'handshake', hostName: header.hostName })
    } catch (error) {
      this.handleClosed(ws, error instanceof Error ? error : new Error('channel handshake failed'))
    }
  }

  /** Foreground liveness check; an open relay socket alone does not prove liveness. */
  probeConnection(timeoutMs = 3_000): Promise<boolean> {
    if (this.probe) return this.probe.promise
    const ws = this.ws
    if (!ws) return Promise.resolve(false)
    let settle!: (ok: boolean) => void
    const promise = new Promise<boolean>(resolve => { settle = resolve })
    const finish = (ok: boolean) => {
      if (this.probe?.promise !== promise) return
      clearTimeout(timer)
      this.probe = null
      settle(ok && this.ws === ws)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    this.probe = { promise, finish }
    if (this.kind === 'lan') {
      // LAN has no ping command today. A small existing read probes the desktop.
      void this.request({ type: 'list_session_activity' } as RemoteCommand, timeoutMs).then(
        result => finish(!(result as { error?: string })?.error), () => finish(false))
    } else {
      // The relay auto-responds only to the literal heartbeat text, never a JSON frame.
      try { this.sendFrame(ws, RELAY_PING) } catch { finish(false) }
    }
    return promise
  }

  reconnect(): Promise<void> {
    const last = this.last
    if (!last) return Promise.reject(new Error('never connected'))
    this.buffer.start()
    if (last.kind === 'relay') return this.connectRelay(last)
    return this.connectLan(last.host, last.port, last.link)
  }

  private async open(url: string, link: HostLink): Promise<void> {
    this.cancelConnect?.()
    this.cancelConnect = null
    this.clearAckTimer()
    this.probe?.finish(false)
    this.stopHeartbeat()
    this.reads.clear()
    this.rpc.failAll(new Error('connection replaced'))
    const previous = this.ws
    this.ws = null
    this.detachAndClose(previous)
    this.resetChannel(new Error('connection replaced'))
    this.closed = false
    this.credential = link.credential
    const keys = deriveKeys(link.credential.secretHex)
    this.fileKeys = { aesKeyBytes: keys.aesKeyBytes, channelKeyHex: keys.channelKeyHex }
    // Frames sealed for an earlier connection cannot be opened on this one, so
    // nothing is replayed: the next relay seq (or the LAN counter) is the base.
    this.tracker.rebase()
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
        this.handleClosed(ws)
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
    this.hooks.onStatus?.(true)
    if (this.ws !== ws) return
    this.startHandshake(ws)
    // Only the relay answers pings; on LAN the desktop is the socket peer, so a
    // dead link surfaces as request failures instead.
    if (this.kind === 'relay') {
      this.heartbeat = createRelayHeartbeat({
        send: (text) => this.sendFrame(ws, text),
        // A half-open socket never fires onclose; treat the missed pong as one
        // so the reconnect loop takes over.
        onTimeout: () => this.handleClosed(ws),
        ...this.hooks.heartbeat,
      })
      this.heartbeat.start()
    }
  }

  private handleClosed(ws: SocketLike, error: Error = new Error('connection closed')): void {
    if (this.ws !== ws) return
    this.ws = null
    this.clearAckTimer()
    this.probe?.finish(false)
    this.stopHeartbeat()
    this.detachAndClose(ws)
    this.resetChannel(error)
    this.reads.clear()
    this.rpc.failAll(error)
    this.hooks.onStatus?.(false)
  }

  private stopHeartbeat(): void {
    this.heartbeat?.stop()
    this.heartbeat = null
  }

  private metric(metric: TransportMetric): void {
    this.hooks.onMetric?.({ ...metric, transport: this.kind })
  }

  private sendFrame(ws: SocketLike, text: string): void {
    ws.send(text)
    if (this.hooks.onMetric) {
      let name = 'unknown'
      try { name = JSON.parse(text).type ?? name } catch { /* non-JSON control */ }
      this.metric({ kind: 'wire-out', name, bytes: new TextEncoder().encode(text).length })
    }
  }

  private onRaw(raw: string): void {
    if (this.hooks.onMetric) {
      let name = 'unknown'
      try { name = JSON.parse(raw).type ?? name } catch { /* malformed frame still costs bytes */ }
      this.metric({ kind: 'wire-in', name, bytes: new TextEncoder().encode(raw).length })
    }
    if (this.probe && this.kind === 'relay' && raw === RELAY_PONG) this.probe.finish(true)
    if (this.heartbeat?.onMessage(raw)) return
    let frame: InboundFrame
    try {
      frame = JSON.parse(raw) as InboundFrame
    } catch {
      return
    }
    const ws = this.ws
    if (!ws) return
    if (frame.type === LINK_CHANNEL_FRAME) {
      this.onChannelFrame(ws, frame as { msg?: unknown; hello?: unknown; data?: unknown })
      return
    }
    if (frame.type === 'peer_connected' && this.kind === 'relay') {
      // A desktop that (re)joined the room holds no channel for us yet.
      this.rpc.failAll(new Error('desktop reconnected'))
      this.reads.clear()
      this.startHandshake(ws)
    } else if (frame.type === 'peer_disconnected' && this.kind === 'relay') {
      this.resetChannel(new Error('desktop disconnected'))
    }
    const decrypt: FrameDecrypt = (data, kind, requestId) => {
      const channel = this.channel
      if (!channel || this.handshake) throw new Error('channel not established')
      const started = performance.now()
      const { header, payload: framed } = openLinkFrame(channel, data)
      if (header.t !== kind || (header.t === 'response' && header.requestId !== requestId)) {
        throw new SecureChannelError('channel_protocol', `link frame kind ${header.t} where ${kind} was expected`)
      }
      const decryptMs = performance.now() - started
      if (this.hooks.onMetric) this.metric({ kind: 'decrypt', name: frame.type ?? 'unknown', durationMs: decryptMs })
      const payload = decodeHostPlaintext(framed)
      if (this.hooks.onMetric) this.metric({ kind: 'decoded', name: frame.type ?? 'unknown', bytes: jsonBytes(payload), durationMs: performance.now() - started - decryptMs })
      return payload
    }
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
        this.hooks.onArrived?.(effect.events)
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
            this.rpc.complete(effect.requestId, decrypt(assembled, 'response', effect.requestId))
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
      this.sendFrame(ws, JSON.stringify({ type: 'ack', seq }))
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
