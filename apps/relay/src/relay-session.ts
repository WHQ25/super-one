interface Env {
  RELAY_SESSION: DurableObjectNamespace
  PAIRING_SESSION: DurableObjectNamespace
}

interface BufferEntry {
  seq: number
  data: string
  recipients: string[]
  pendingAcks: Set<string>
}

type RelayFrame =
  | { type: 'event'; data: string; targets?: string[] }
  | { type: 'command'; data: string; mobileDeviceId?: string }
  | { type: 'register'; deviceName: string; mobileDeviceId: string }
  | { type: 'handshake'; hostName: string }
  | { type: 'kicked'; mobileDeviceId: string }
  | { type: 'response'; requestId: string; data: string; mobileDeviceId?: string }
  | { type: 'response_chunk'; requestId: string; index: number; total: number; data: string; mobileDeviceId?: string }
  | { type: 'ack'; seq: number }
  | { type: 'replay'; fromSeq: number }

const MAX_BUFFER_SIZE = 500
const IDLE_TIMEOUT_MS = 30 * 60 * 1000
const DESKTOP_TAG = 'desktop'
const MOBILE_TAG_PREFIX = 'mobile:'
const SEQ_KEY = 'seq'
const FORCED_DROP_KEY = 'forcedDropSeq'

export class RelaySession implements DurableObject {
  private seq = 0
  private buffer: BufferEntry[] = []
  private deviceAckedSeq = new Map<string, number>()
  private forcedDropSeq = 0
  readonly ready: Promise<void>

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    this.ready = state.blockConcurrencyWhile(async () => {
      const persistedSeq = await state.storage.get<number>(SEQ_KEY)
      const persistedForcedDrop = await state.storage.get<number>(FORCED_DROP_KEY)
      if (typeof persistedSeq === 'number') this.seq = persistedSeq
      if (typeof persistedForcedDrop === 'number') this.forcedDropSeq = persistedForcedDrop
    })
  }

  private getDesktop(): WebSocket | null {
    const sockets = this.state.getWebSockets(DESKTOP_TAG)
    return sockets.length > 0 ? sockets[0] : null
  }

  private getAllMobiles(): WebSocket[] {
    return this.state.getWebSockets().filter((ws) => this.getMobileDeviceId(ws) !== null)
  }

  private getMobileByDeviceId(deviceId: string): WebSocket | null {
    const sockets = this.state.getWebSockets(MOBILE_TAG_PREFIX + deviceId)
    return sockets.length > 0 ? sockets[0] : null
  }

  private getMobileDeviceId(ws: WebSocket): string | null {
    const tags = this.state.getTags(ws)
    for (const tag of tags) {
      if (tag.startsWith(MOBILE_TAG_PREFIX)) return tag.slice(MOBILE_TAG_PREFIX.length)
    }
    return null
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
      return Response.json({ desktop: desktop !== null })
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
      for (const mobile of this.getAllMobiles()) {
        mobile.send(JSON.stringify({ type: 'peer_disconnected' }))
      }
    } else if (role === 'mobile') {
      const deviceId = this.getMobileDeviceId(ws)
      const desktop = this.getDesktop()
      desktop?.send(JSON.stringify({ type: 'peer_disconnected', mobileDeviceId: deviceId }))
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws)
  }

  async alarm(): Promise<void> {
    this.getDesktop()?.close(1000, 'idle_timeout')
    for (const mobile of this.getAllMobiles()) mobile.close(1000, 'idle_timeout')
    this.buffer = []
    this.seq = 0
    this.deviceAckedSeq.clear()
    this.forcedDropSeq = 0
    await this.state.storage.put(SEQ_KEY, 0)
    await this.state.storage.put(FORCED_DROP_KEY, 0)
  }

  private handleDesktopMessage(frame: RelayFrame): void {
    switch (frame.type) {
      case 'event': {
        const targets = frame.targets && frame.targets.length > 0 ? frame.targets : null
        let recipientIds: string[]
        if (targets) {
          recipientIds = targets
        } else {
          recipientIds = []
          for (const mobile of this.getAllMobiles()) {
            const deviceId = this.getMobileDeviceId(mobile)
            if (deviceId) recipientIds.push(deviceId)
          }
        }
        const entry = this.enqueue(frame.data, recipientIds)
        for (const deviceId of recipientIds) {
          const ws = this.getMobileByDeviceId(deviceId)
          ws?.send(JSON.stringify({ type: 'event', seq: entry.seq, data: entry.data }))
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
    }
  }

  private handleMobileMessage(senderWs: WebSocket, frame: RelayFrame): void {
    const desktop = this.getDesktop()
    const senderDeviceId = this.getMobileDeviceId(senderWs)
    switch (frame.type) {
      case 'command':
        desktop?.send(JSON.stringify({ ...frame, mobileDeviceId: senderDeviceId }))
        break
      case 'register':
        desktop?.send(JSON.stringify(frame))
        break
      case 'ack':
        this.handleAck(senderDeviceId, frame.seq)
        break
      case 'replay':
        this.handleReplay(senderWs, frame.fromSeq)
        break
    }
  }

  private enqueue(data: string, recipients: string[]): BufferEntry {
    this.seq++
    void this.state.storage.put(SEQ_KEY, this.seq)
    const entry: BufferEntry = {
      seq: this.seq,
      data,
      recipients,
      pendingAcks: new Set(recipients),
    }
    this.buffer.push(entry)
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      const dropped = this.buffer.shift()
      if (dropped && dropped.pendingAcks.size > 0 && dropped.seq > this.forcedDropSeq) {
        this.forcedDropSeq = dropped.seq
        void this.state.storage.put(FORCED_DROP_KEY, this.forcedDropSeq)
        console.warn(
          `[RelaySession] forced drop seq=${dropped.seq} pending=${Array.from(dropped.pendingAcks).join(',')} ` +
          `recipients=${dropped.recipients.join(',')} buffer overflow MAX_BUFFER_SIZE=${MAX_BUFFER_SIZE}`,
        )
      }
    }
    return entry
  }

  private handleAck(deviceId: string | null, seq: number): void {
    if (!deviceId) return
    const cur = this.deviceAckedSeq.get(deviceId) ?? 0
    if (seq <= cur) return
    this.deviceAckedSeq.set(deviceId, seq)
    for (const entry of this.buffer) {
      if (entry.seq <= seq) entry.pendingAcks.delete(deviceId)
    }
    this.gcBuffer()
  }

  private gcBuffer(): void {
    while (this.buffer.length > 0 && this.buffer[0].pendingAcks.size === 0) {
      this.buffer.shift()
    }
  }

  private handleReplay(mobile: WebSocket, fromSeq: number): void {
    const deviceId = this.getMobileDeviceId(mobile)
    if (!deviceId) return

    if (fromSeq <= this.forcedDropSeq) {
      console.warn(
        `[RelaySession] replay reset device=${deviceId} fromSeq=${fromSeq} <= forcedDropSeq=${this.forcedDropSeq} ` +
        `(buffer overflowed before device caught up)`,
      )
      mobile.send(JSON.stringify({ type: 'reset' }))
      return
    }

    for (const entry of this.buffer) {
      if (entry.seq < fromSeq) continue
      if (!entry.recipients.includes(deviceId)) continue
      mobile.send(JSON.stringify({ type: 'event', seq: entry.seq, data: entry.data }))
    }
  }

  private touchIdleTimer(): void {
    this.state.storage.setAlarm(Date.now() + IDLE_TIMEOUT_MS)
  }
}
