import { WebSocketServer, type WebSocket } from 'ws'

/**
 * In-process stand-in for `apps/relay` (`relay-session.ts`) for tests: one
 * `desktop` socket and per-device `mobile` slots per room, `channel` and
 * `kicked` routing, peer announcements and the `ping` auto-response. Event
 * buffering is left out; the node channel does not use it.
 */
export async function startTestRelay() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const rooms = new Map<string, { desktop: WebSocket | null; mobiles: Map<string, WebSocket> }>()
  /** Every text frame the relay received, to check nothing secret crosses it. */
  const seen: string[] = []
  const roomOf = (id: string) => {
    let room = rooms.get(id)
    if (!room) rooms.set(id, (room = { desktop: null, mobiles: new Map() }))
    return room
  }
  server.on('connection', (socket, req) => {
    const url = new URL(req.url ?? '/', 'http://relay')
    const room = roomOf(url.searchParams.get('room') ?? '')
    const role = url.searchParams.get('role')
    const deviceId = url.searchParams.get('deviceId') ?? ''
    if (role === 'desktop') {
      room.desktop?.close(1000, 'replaced')
      room.desktop = socket
      for (const mobile of room.mobiles.values()) mobile.send(JSON.stringify({ type: 'peer_connected' }))
    } else {
      room.mobiles.get(deviceId)?.close(1000, 'replaced')
      room.mobiles.set(deviceId, socket)
      room.desktop?.send(JSON.stringify({ type: 'peer_connected', mobileDeviceId: deviceId }))
    }
    socket.on('message', (raw) => {
      const text = raw.toString()
      if (text === 'ping') {
        socket.send('pong')
        return
      }
      seen.push(text)
      const frame = JSON.parse(text) as Record<string, unknown>
      if (role === 'desktop') {
        if (frame.type === 'channel' || frame.type === 'kicked') {
          room.mobiles.get(String(frame.mobileDeviceId))?.send(text)
        }
        return
      }
      if (frame.type === 'channel') room.desktop?.send(JSON.stringify({ ...frame, mobileDeviceId: deviceId }))
    })
    socket.on('close', () => {
      if (role === 'desktop') {
        if (room.desktop !== socket) return
        room.desktop = null
        for (const mobile of room.mobiles.values()) mobile.send(JSON.stringify({ type: 'peer_disconnected' }))
      } else if (room.mobiles.get(deviceId) === socket) {
        room.mobiles.delete(deviceId)
        room.desktop?.send(JSON.stringify({ type: 'peer_disconnected', mobileDeviceId: deviceId }))
      }
    })
  })
  const port = (server.address() as { port: number }).port
  return {
    url: `ws://127.0.0.1:${port}`,
    seen,
    hasDesktop: (roomId: string) => rooms.get(roomId)?.desktop != null,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of server.clients) client.terminate()
        server.close(() => resolve())
      }),
  }
}
