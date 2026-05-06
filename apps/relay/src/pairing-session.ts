interface Env {
  RELAY_SESSION: DurableObjectNamespace
  PAIRING_SESSION: DurableObjectNamespace
}

type PairFrame =
  | { type: 'pair_request'; data: string }
  | { type: 'pair_response'; data: string }
  | { type: 'pair_rejected' }
  | { type: 'pair_already_paired' }

export class PairingSession implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  private getWsByTag(tag: string): WebSocket | null {
    const sockets = this.state.getWebSockets(tag)
    return sockets.length > 0 ? sockets[0] : null
  }

  private getRole(ws: WebSocket): 'desktop' | 'mobile' | null {
    const tags = this.state.getTags(ws)
    if (tags.includes('desktop')) return 'desktop'
    if (tags.includes('mobile')) return 'mobile'
    return null
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const role = url.searchParams.get('role')
    if (role !== 'desktop' && role !== 'mobile') {
      return new Response('Invalid role', { status: 400 })
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    const existing = this.getWsByTag(role)
    if (existing) {
      existing.close(1000, 'replaced')
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    this.state.acceptWebSocket(server, [role])
    this.scheduleExpiry()

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return

    let frame: PairFrame
    try {
      frame = JSON.parse(message)
    } catch {
      return
    }

    const role = this.getRole(ws)
    const peerTag = role === 'desktop' ? 'mobile' : 'desktop'
    const peer = this.getWsByTag(peerTag)
    if (!peer) return

    peer.send(message)

    if (frame.type === 'pair_response' || frame.type === 'pair_rejected' || frame.type === 'pair_already_paired') {
      setTimeout(() => this.cleanup(), 1000)
    }
  }

  async webSocketClose(): Promise<void> {
    const desktop = this.getWsByTag('desktop')
    const mobile = this.getWsByTag('mobile')
    if (!desktop && !mobile) this.cleanup()
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose()
  }

  async alarm(): Promise<void> {
    this.cleanup()
  }

  private scheduleExpiry(): void {
    this.state.storage.setAlarm(Date.now() + 3 * 60 * 1000)
  }

  private cleanup(): void {
    this.getWsByTag('desktop')?.close(1000, 'pairing_complete')
    this.getWsByTag('mobile')?.close(1000, 'pairing_complete')
    this.state.storage.deleteAlarm()
  }
}
