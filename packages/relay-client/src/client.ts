import { type TransportMetric } from './transport-ledger'
import type { ReadDesktopFileResponse } from '@superone/shared/agent-types'
import { EventBuffer } from './buffer'
import { buildLanWsUrl, buildRelayWsUrl, type TransportKind } from './connect'
import { deriveKeys } from './crypto'
import { handleInboundFrame, type InboundFrame, type RelayControlFrame } from './frames'
import { LINK_CHANNEL_FRAME, PHONE_RPC_ENVELOPE, openLinkFrame, sealLinkFrame, type LinkHostInfo } from './phone-link'
import { DesktopUpgradeRequiredError, PhoneProtocol, type PhoneRpcOptions, type PhoneTopicStream } from './phone-protocol'
import { requirePhoneDesktop } from './phone-version'
import type { TopicSubscribeInput } from '@superone/shared/environment/events'
import type { RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import type { DetailUpdate } from '@superone/shared/environment/detail'
import type { SessionRef, TerminalRef } from '@superone/shared/environment/refs'
import type { ControlLease, MutatingControlContext } from '@superone/shared/environment/lease'
import type { SessionLoadCursor } from '@superone/shared/environment/session-messages'
import type { ProjectRef } from '@superone/shared/environment/refs'
import { sessionKey } from '@superone/shared/environment/refs'
import { PhoneProjectCatalog } from './project-catalog'
import { PhoneSessionFeed } from './session-feed'
import { PhoneTerminalFeed, type PhoneTerminalStream } from './terminal-feed'
import { PhoneWorkspaceFeed } from './workspace-feed'
import type { TopicRef } from '@superone/shared/environment/topics'
import type { TerminalEvent, TerminalSnapshot } from '@superone/shared/agent-types'
import { createSessionView } from './session-view'
import { SecureChannel, SecureChannelError, startClientHandshake, type ChannelCredential } from './secure-channel'
import { createRelayHeartbeat, RELAY_PING, RELAY_PONG, type RelayHeartbeat } from '@superone/shared/relay-heartbeat'
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

const defaultOpenSocket: OpenSocket = (url) => new WebSocket(url) as unknown as SocketLike

export class RelayClient {
  private ws: SocketLike | null = null
  private credential: ChannelCredential | null = null
  /** Static per-pairing keys for relay-staged files; frames use the channel. */
  private fileKeys: { aesKeyBytes: Uint8Array; channelKeyHex: string } | null = null
  private channel: SecureChannel | null = null
  private handshake: { nonce: string; finish: ReturnType<typeof startClientHandshake>['finish'] } | null = null
  private ready: ChannelReady = channelReady()
  private protocol: PhoneProtocol | null = null
  private host: LinkHostInfo | undefined
  private readonly projects = new PhoneProjectCatalog((method, payload, options) => this.rpc(method, payload, options), () => this.host!.environmentId!)
  private readonly sessionFeed = new PhoneSessionFeed((input, handlers) => this.subscribeTopics(input, handlers), events => this.deliverEvents(events), (session, error) => this.hooks.onSessionRecovery?.(session, error), session => this.retainSession(session))
  private sessionUses = new Map<string, number>()
  private activeSessionStop: (() => Promise<void>) | null = null
  private readonly defaultSessionStop = () => this.sessionFeed.stop()
  private readonly workspaceFeeds = new Map<string, { feed: PhoneWorkspaceFeed; ready: Promise<void> }>()
  readonly buffer = new EventBuffer()
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
      onProtocolMessage?: (message: unknown) => void
      onSessionRecovery?: (session: SessionRef, error?: Error) => void
      onControlLost?: (resource: SessionRef | TerminalRef, error: Error) => void
      onWorkspaceSnapshot?: (topic: TopicRef, snapshot: unknown) => void
      onWorkspaceRecovery?: (topic: TopicRef, error?: Error) => void
      onShutdown?: () => void
      onControl?: (frame: RelayControlFrame) => void
      onStatus?: (connected: boolean) => void
      /** Fatal authenticated-host contract failures, before disconnect status is reported. */
      onConnectionError?: (error: Error) => void
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

  get environmentId(): string | null { return this.host?.environmentId ?? null }

  async verifyHost(): Promise<void> { await (await this.protocolReady(15_000, 'handshake')).start() }

  async resolveProject(projectPath: string): Promise<ProjectRef> {
    await this.protocolReady(15_000, 'project.list')
    return this.projects.resolve(projectPath)
  }

  async followSession(input: { session: SessionRef; projectPath: string; provider?: string; cursor: SessionLoadCursor }): Promise<void> {
    await this.sessionFeed.follow(input)
    this.activateSessionView(this.defaultSessionStop)
  }

  stopSession(): Promise<void> {
    const stop = this.activeSessionStop
    this.activeSessionStop = null
    return stop ? stop() : this.sessionFeed.stop()
  }

  createSessionView() { return createSessionView(this) }
  activateSessionView(stop: () => Promise<void>): void {
    const previous = this.activeSessionStop
    this.activeSessionStop = stop
    if (previous && previous !== stop) void previous().catch(() => {})
  }
  publishSessionEvents(events: unknown[]): void { this.deliverEvents(events) }
  recoverSession(session: SessionRef, error?: Error): void { this.hooks.onSessionRecovery?.(session, error) }
  retainSession(session: SessionRef): (proof?: MutatingControlContext) => Promise<void> {
    const key = sessionKey(session), uses = this.sessionUses
    uses.set(key, (uses.get(key) ?? 0) + 1)
    let released = false
    return async (proof) => {
      if (released) return
      released = true
      const count = uses.get(key) ?? 0
      if (count > 1) uses.set(key, count - 1)
      else if (count === 1) { uses.delete(key); await this.releaseControl(session, proof).catch(() => {}) }
    }
  }

  private deliverEvents(events: unknown[]): void {
    this.hooks.onArrived?.(events)
    if (this.buffer.isBuffering) this.buffer.push(events)
    else this.hooks.onEvents?.(events, this.buffer.epoch)
  }

  async rpc<T = unknown>(method: string, payload: unknown = {}, options: PhoneRpcOptions = {}): Promise<T> {
    const protocol = await this.protocolReady(options.timeoutMs ?? 15_000, method)
    const result = await protocol.rpc<T>(method, payload, options)
    if (method === 'project.open' || method === 'project.update' || method === 'project.remove' || method === 'git.clone') this.projects.invalidate()
    return result
  }

  async acquireControl(resource: SessionRef | TerminalRef, options: { reclaim?: boolean } = {}): Promise<ControlLease> {
    return (await this.protocolReady(15_000, 'acquireControl')).control.acquire(resource, options)
  }

  /** An explicit sidebar action may control an unopened session for just this operation. */
  async operateSession<T = unknown>(resource: SessionRef, method: string, payload: Record<string, unknown> = {}, options: Omit<PhoneRpcOptions, 'environmentId'> = {}): Promise<T> {
    const protocol = await this.protocolReady(options.timeoutMs ?? 15_000, method)
    const release = this.retainSession(resource)
    let proof: MutatingControlContext | undefined
    try {
      const grant = await protocol.control.acquire(resource)
      proof = { leaseId: grant.leaseId, generation: grant.generation }
      return await protocol.rpc<T>(method, { ...payload, sessionId: resource.sessionId, ...proof }, { ...options, environmentId: resource.environmentId })
    } finally {
      await release(proof)
    }
  }

  controlledRpc<T = unknown>(resource: SessionRef | TerminalRef, method: string, payload: Record<string, unknown> = {}, options: Omit<PhoneRpcOptions, 'environmentId'> = {}): Promise<T> {
    // Snapshot this channel's proof before any await; a queued action cannot borrow a later grant.
    if (!this.protocol) return Promise.reject(this.ws ? new DesktopUpgradeRequiredError(this.host) : new Error('not connected'))
    return this.protocol.control.call<T>(resource, method, payload, options)
  }

  releaseControl(resource: SessionRef | TerminalRef, proof?: MutatingControlContext): Promise<void> {
    return this.protocol?.control.release(resource, proof) ?? Promise.resolve()
  }

  async subscribeTopics(input: Omit<TopicSubscribeInput, 'subscriptionId'>, handlers: RpcStreamHandlers): Promise<PhoneTopicStream> {
    return (await this.protocolReady(15_000, 'topic.subscribe')).subscribe(input, handlers)
  }

  followTerminal(resource: TerminalRef, onEvent: (event: TerminalEvent) => void, onEnd: (error: Error) => void): PhoneTerminalStream {
    const protocol = this.protocolReady(15_000, 'terminal.attach')
    return new PhoneTerminalFeed(resource, {
      subscribe: async (input, handlers) => (await protocol).subscribe(input, handlers),
      attach: async () => (await protocol).rpc<{ snapshot: string; sequence: string; terminal: TerminalSnapshot }>('terminal.attach', { terminalId: resource.terminalId }, { environmentId: resource.environmentId }),
    }, onEvent, onEnd)
  }

  async followWorkspace(environmentId?: string): Promise<void> {
    const protocol = await this.protocolReady(15_000, 'topic.subscribe')
    const target = environmentId ?? protocol.host.environmentId!
    const existing = this.workspaceFeeds.get(target)
    if (existing) return existing.ready
    const feed = new PhoneWorkspaceFeed((input, handlers) => protocol.subscribe(input, handlers), {
      onSnapshot: (topic, snapshot) => {
        if (this.protocol !== protocol) return
        if (topic.kind === 'projects') this.projects.invalidate()
        this.hooks.onWorkspaceSnapshot?.(topic, snapshot)
      },
      onEvents: events => {
        if (this.protocol !== protocol) return
        if (events.some(event => event.type === 'project_list_changed')) this.projects.invalidate()
        this.hooks.onArrived?.(events)
      },
      onTerminal: event => { if (this.protocol === protocol) this.hooks.onTerminal?.({ ...event, environmentId: target }) },
      onRecover: (topic, error) => { if (this.protocol === protocol) this.hooks.onWorkspaceRecovery?.(topic, error) },
    })
    const entry = { feed, ready: feed.follow(target) }
    this.workspaceFeeds.set(target, entry)
    try { await entry.ready }
    catch (error) { if (this.workspaceFeeds.get(target) === entry) this.workspaceFeeds.delete(target); throw error }
  }

  async stopWorkspace(environmentId: string): Promise<void> {
    const entry = this.workspaceFeeds.get(environmentId)
    this.workspaceFeeds.delete(environmentId)
    await entry?.feed.stop()
  }

  async subscribeDetail(input: { sessionId: string; detailRef: string; subscriptionId: string }, listener: (update: DetailUpdate) => void, options: PhoneRpcOptions = {}): Promise<DetailUpdate> {
    return (await this.protocolReady(15_000, 'session.subscribeDetail')).subscribeDetail(input, listener, options)
  }

  async unsubscribeDetail(input: { sessionId: string; subscriptionId: string }, options: PhoneRpcOptions = {}): Promise<void> {
    return (await this.protocolReady(15_000, 'session.unsubscribeDetail')).unsubscribeDetail(input, options)
  }

  private async protocolReady(timeoutMs: number, method: string): Promise<PhoneProtocol> {
    const ws = this.ws
    if (!ws) throw new Error('not connected')
    await this.whenChannelReady(ws, timeoutMs, method)
    if (this.ws !== ws) throw new Error('connection replaced')
    if (!this.protocol) throw new DesktopUpgradeRequiredError(this.host)
    return this.protocol
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
    this.probe?.finish(false)
    this.stopHeartbeat()
    const ws = this.ws
    this.ws = null
    this.detachAndClose(ws)
    this.resetChannel(new Error('disconnected'))
    this.buffer.stop()
    if (ws) this.hooks.onStatus?.(false)
  }

  uploadFile(
    input: Omit<UploadBytesOptions, 'transport' | 'lanHost' | 'aesKeyBytes' | 'channelKeyHex' | 'rpc' | 'put'>,
    put: HttpPut,
  ): Promise<string> {
    if (!this.ws || !this.fileKeys) return Promise.reject(new Error('not connected'))
    return uploadBytes({
      ...input,
      transport: this.kind,
      lanHost: this.last?.kind === 'lan' ? this.last.host : undefined,
      aesKeyBytes: this.fileKeys.aesKeyBytes,
      channelKeyHex: this.fileKeys.channelKeyHex,
      rpc: (method, payload, timeoutMs) => this.rpc(method, payload, { timeoutMs }),
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

  /** Resolves once both the paired channel and the native host contract are verified. */
  private whenChannelReady(ws: SocketLike, timeoutMs: number, name: string): Promise<void> {
    if (this.ws !== ws) return Promise.reject(new Error('connection replaced'))
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
    for (const { feed } of this.workspaceFeeds.values()) feed.reset()
    this.workspaceFeeds.clear()
    this.activeSessionStop = null
    this.sessionUses.clear()
    this.sessionUses = new Map()
    this.sessionFeed.reset()
    this.projects.invalidate()
    this.protocol?.close(error)
    this.protocol = null
    this.host = undefined
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
      this.host = header.host
      requirePhoneDesktop(header.host)
      {
        const channel = this.channel
        const protocol = new PhoneProtocol(header.host, (out) => {
          if (this.ws !== ws || this.channel !== channel) throw new Error('connection replaced')
          this.sendFrame(ws, JSON.stringify({ type: 'command', data: sealLinkFrame(channel, { t: 'rpc' }, out) }))
        }, (message) => {
          if ((message as { type?: string })?.type === 'composer_settled') this.deliverEvents([message])
          this.hooks.onProtocolMessage?.(message)
        }, undefined, (resource, error) => this.hooks.onControlLost?.(resource, error))
        this.protocol = protocol
        void protocol.start().then(() => {
          if (this.protocol !== protocol) return
          this.ready.resolve()
          this.hooks.onControl?.({ type: 'handshake', hostName: header.hostName, host: header.host })
        }).catch((error: unknown) => {
          if (this.protocol === protocol) this.handleClosed(ws, error instanceof Error ? error : new Error(String(error)))
        })
      }
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
      void this.rpc('environment.health', {}, { timeoutMs }).then(() => finish(true), () => finish(false))
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
    this.probe?.finish(false)
    this.stopHeartbeat()
    const previous = this.ws
    this.ws = null
    this.detachAndClose(previous)
    this.resetChannel(new Error('connection replaced'))
    this.closed = false
    this.credential = link.credential
    const keys = deriveKeys(link.credential.secretHex)
    this.fileKeys = { aesKeyBytes: keys.aesKeyBytes, channelKeyHex: keys.channelKeyHex }
    // Frames sealed for an earlier connection cannot be opened on this one, so
    // nothing is replayed; the caller restores state over the new channel.
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
    this.probe?.finish(false)
    this.stopHeartbeat()
    this.detachAndClose(ws)
    this.resetChannel(error)
    this.hooks.onConnectionError?.(error)
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
      this.startHandshake(ws)
    } else if (frame.type === 'peer_disconnected' && this.kind === 'relay') {
      this.resetChannel(new Error('desktop disconnected'))
    }
    if (frame.type === PHONE_RPC_ENVELOPE && typeof frame.data === 'string') {
      try {
        if (!this.channel || this.handshake) return
        const { header, payload } = openLinkFrame(this.channel, frame.data)
        if (header.t === 'rpc') {
          if (!this.protocol) throw new DesktopUpgradeRequiredError(this.host)
          this.protocol.receive(payload)
        } else {
          throw new SecureChannelError('channel_protocol', `unexpected ${header.t} on protocol lane`)
        }
      } catch (error) {
        this.handleClosed(ws, error instanceof Error ? error : new Error(String(error)))
      }
      return
    }
    const effect = handleInboundFrame(frame)
    switch (effect.kind) {
      case 'drop':
      case 'pong':
        return
      case 'desktop_shutdown':
        this.buffer.stop()
        this.hooks.onShutdown?.()
        return
      case 'control':
        this.hooks.onControl?.(effect.frame)
        return
    }
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
