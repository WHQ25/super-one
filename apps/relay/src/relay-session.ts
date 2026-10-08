interface Env {
  RELAY_SESSION: DurableObjectNamespace
  PAIRING_SESSION: DurableObjectNamespace
}

type RelayFrame =
  | { type: 'event'; data: string; targets?: string[] }
  | { type: 'command'; data: string; mobileDeviceId?: string }
  | { type: 'register'; deviceName: string; mobileDeviceId: string }
  | { type: 'handshake'; hostName: string }
  | { type: 'kicked'; mobileDeviceId: string }
  | { type: 'desktop_shutdown' }
  | { type: 'response'; requestId: string; data: string; mobileDeviceId?: string }
  | { type: 'response_chunk'; requestId: string; index: number; total: number; data: string; mobileDeviceId?: string }
  /** Pre-channel phones only; see `legacySeq`. */
  | { type: 'ack'; seq: number }
  | { type: 'replay'; fromSeq: number }
  | { type: 'terminal'; data: string; targets?: string[] }
  /** Secure-channel handshake between one phone and the desktop. */
  | { type: 'channel'; mobileDeviceId?: string; [key: string]: unknown }

const IDLE_TIMEOUT_MS = 30 * 60 * 1000
/**
 * Clients send the literal `ping` every 30s and give up on a pong after 10s
 * (`RELAY_HEARTBEAT_*` in `@superone/shared/relay-heartbeat`). A desktop whose
 * last auto-response is older than one missed round trip is a half-open socket
 * the runtime has not noticed yet — not a peer a mobile can talk to.
 */
const HEARTBEAT_STALE_MS = 2 * 30_000 + 10_000
const DESKTOP_TAG = 'desktop'
const MOBILE_TAG_PREFIX = 'mobile:'

/**
 * The relay forwards ciphertext and keeps nothing. Each phone's frames are
 * sealed under its own secure channel, whose sequence numbers already reject
 * replays and reordering, and frames from an earlier connection cannot be
 * opened, so a phone restores state on reconnect instead of asking for replay.
 * Contract: docs/architecture/relay-crypto.md.
 */
export class RelaySession implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  /**
   * `getWebSockets()` still lists a socket that is CLOSING — the one a
   * redialling peer just replaced, which on a half-open link never finishes
   * closing. Tags are appended in accept order, so the newest OPEN socket is
   * the live peer.
   */
  private newestOpen(sockets: WebSocket[]): WebSocket | null {
    for (let i = sockets.length - 1; i >= 0; i -= 1) {
      if (sockets[i].readyState === WebSocket.OPEN) return sockets[i]
    }
    return null
  }

  private getDesktop(): WebSocket | null {
    return this.newestOpen(this.state.getWebSockets(DESKTOP_TAG))
  }

  /**
   * One live socket per device. The untagged list is not in accept order
   * (workerd iterates it newest-first), so resolve each device through the
   * tagged selector rather than trusting any ordering here.
   */
  private getAllMobiles(): WebSocket[] {
    const deviceIds = new Set<string>()
    for (const ws of this.state.getWebSockets()) {
      const deviceId = this.getMobileDeviceId(ws)
      if (deviceId !== null) deviceIds.add(deviceId)
    }
    const live: WebSocket[] = []
    for (const deviceId of deviceIds) {
      const ws = this.getMobileByDeviceId(deviceId)
      if (ws) live.push(ws)
    }
    return live
  }

  private getMobileByDeviceId(deviceId: string): WebSocket | null {
    return this.newestOpen(this.state.getWebSockets(MOBILE_TAG_PREFIX + deviceId))
  }

  private getMobileDeviceId(ws: WebSocket): string | null {
    const tags = this.state.getTags(ws)
    for (const tag of tags) {
      if (tag.startsWith(MOBILE_TAG_PREFIX)) return tag.slice(MOBILE_TAG_PREFIX.length)
    }
    return null
  }

  /**
   * A socket that has never pinged is either freshly attached or a pre-heartbeat
   * client; only a lapsed heartbeat proves the link is dead.
   */
  private isHeartbeatFresh(ws: WebSocket): boolean {
    const lastPong = this.state.getWebSocketAutoResponseTimestamp(ws)
    return lastPong === null || Date.now() - lastPong.getTime() < HEARTBEAT_STALE_MS
  }

  private getRole(ws: WebSocket): 'desktop' | 'mobile' | null {
    const tags = this.state.getTags(ws)
    if (tags.includes(DESKTOP_TAG)) return 'desktop'
    if (tags.some((t) => t.startsWith(MOBILE_TAG_PREFIX))) return 'mobile'
    return null
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/status') {
      const desktop = this.getDesktop()
      return Response.json({ desktop: desktop !== null && this.isHeartbeatFresh(desktop) })
    }

    const role = url.searchParams.get('role')
    if (role !== 'desktop' && role !== 'mobile') {
      return new Response('Invalid role', { status: 400 })
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    let tag: string
    let mobileDeviceId: string | null = null
    if (role === 'desktop') {
      const existing = this.getDesktop()
      if (existing) existing.close(1000, 'replaced')
      tag = DESKTOP_TAG
    } else {
      mobileDeviceId = url.searchParams.get('deviceId')
      if (!mobileDeviceId) return new Response('mobile must include deviceId query param', { status: 400 })
      const existing = this.getMobileByDeviceId(mobileDeviceId)
      if (existing) existing.close(1000, 'replaced')
      tag = MOBILE_TAG_PREFIX + mobileDeviceId
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.state.acceptWebSocket(server, [tag])

    if (role === 'mobile') {
      const desktop = this.getDesktop()
      desktop?.send(JSON.stringify({ type: 'peer_connected', mobileDeviceId }))
    } else {
      for (const mobile of this.getAllMobiles()) {
        mobile.send(JSON.stringify({ type: 'peer_connected' }))
      }
    }

    this.touchIdleTimer()
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return
    this.touchIdleTimer()

    let frame: RelayFrame
    try {
      frame = JSON.parse(message)
    } catch {
      return
    }

    const role = this.getRole(ws)
    if (role === 'desktop') {
      this.handleDesktopMessage(frame)
    } else if (role === 'mobile') {
      this.handleMobileMessage(ws, frame)
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const role = this.getRole(ws)
    if (role === 'desktop') {
      // A replaced socket closing late must not announce the live desktop as gone.
      if (this.getDesktop() !== null) return
      for (const mobile of this.getAllMobiles()) {
        mobile.send(JSON.stringify({ type: 'peer_disconnected' }))
      }
    } else if (role === 'mobile') {
      const deviceId = this.getMobileDeviceId(ws)
      if (deviceId !== null && this.getMobileByDeviceId(deviceId) !== null) return
      const desktop = this.getDesktop()
      desktop?.send(JSON.stringify({ type: 'peer_disconnected', mobileDeviceId: deviceId }))
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws)
  }

  async alarm(): Promise<void> {
    // Auto-response pings never wake the DO, so a pair that is alive but has
    // exchanged no business frames looks idle here; its heartbeat says otherwise.
    const desktop = this.getDesktop()
    if (desktop && this.state.getWebSocketAutoResponseTimestamp(desktop) !== null && this.isHeartbeatFresh(desktop)) {
      this.touchIdleTimer()
      return
    }
    desktop?.close(1000, 'idle_timeout')
    for (const mobile of this.getAllMobiles()) mobile.close(1000, 'idle_timeout')
  }

  private handleDesktopMessage(frame: RelayFrame): void {
    switch (frame.type) {
      case 'event': {
        for (const ws of this.recipients(frame.targets)) {
          ws.send(JSON.stringify({ type: 'event', seq: this.legacySeq(ws), data: frame.data }))
        }
        break
      }
      case 'handshake':
        for (const mobile of this.getAllMobiles()) {
          mobile.send(JSON.stringify(frame))
        }
        break
      case 'kicked': {
        const target = this.getMobileByDeviceId(frame.mobileDeviceId)
        target?.send(JSON.stringify(frame))
        break
      }
      case 'channel': {
        if (typeof frame.mobileDeviceId !== 'string') break
        this.getMobileByDeviceId(frame.mobileDeviceId)?.send(JSON.stringify(frame))
        break
      }
      case 'desktop_shutdown': {
        const payload = JSON.stringify(frame)
        for (const mobile of this.getAllMobiles()) {
          mobile.send(payload)
        }
        break
      }
      case 'response':
      case 'response_chunk': {
        if (frame.mobileDeviceId) {
          const ws = this.getMobileByDeviceId(frame.mobileDeviceId)
          ws?.send(JSON.stringify(frame))
        } else {
          for (const mobile of this.getAllMobiles()) {
            mobile.send(JSON.stringify(frame))
          }
        }
        break
      }
      case 'terminal': {
        const payload = JSON.stringify(frame)
        for (const ws of this.recipients(frame.targets)) ws.send(payload)
        break
      }
    }
  }

  private handleMobileMessage(senderWs: WebSocket, frame: RelayFrame): void {
    const desktop = this.getDesktop()
    const senderDeviceId = this.getMobileDeviceId(senderWs)
    switch (frame.type) {
      case 'command':
      case 'channel':
        desktop?.send(JSON.stringify({ ...frame, mobileDeviceId: senderDeviceId }))
        break
      case 'register':
        desktop?.send(JSON.stringify(frame))
        break
      case 'replay':
        // Nothing is kept to replay: a pre-channel phone rebases and restores.
        senderWs.send(JSON.stringify({ type: 'reset' }))
        break
    }
  }

  /** Listed devices that are connected, or every connected phone. */
  private recipients(targets: string[] | undefined): WebSocket[] {
    if (!targets || targets.length === 0) return this.getAllMobiles()
    const live: WebSocket[] = []
    for (const deviceId of new Set(targets)) {
      const ws = this.getMobileByDeviceId(deviceId)
      if (ws) live.push(ws)
    }
    return live
  }

  /**
   * Envelope seq, contiguous per phone socket, for phones built before the
   * secure channel: they drop any `event` without one and ACK a contiguous
   * watermark. Current phones ignore it. Kept in the socket attachment so it
   * survives hibernation; remove once no pre-channel phone connects.
   */
  private legacySeq(ws: WebSocket): number {
    const seq = ((ws.deserializeAttachment() as { seq?: number } | null)?.seq ?? 0) + 1
    ws.serializeAttachment({ seq })
    return seq
  }

  private touchIdleTimer(): void {
    this.state.storage.setAlarm(Date.now() + IDLE_TIMEOUT_MS)
  }
}
