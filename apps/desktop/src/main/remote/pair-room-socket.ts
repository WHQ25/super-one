import WebSocket from 'ws'
import type { PairRoomSocket } from '@superone/relay-client/pair-room'

/** A relay pairing-room socket for `joinPairRoom`, over Node `ws`. */
export function openPairRoomSocket(url: string): PairRoomSocket {
  const ws = new WebSocket(url)
  const socket: PairRoomSocket = {
    send: (data) => ws.send(data),
    close: () => ws.close(1000),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  }
  ws.on('open', () => socket.onopen?.())
  ws.on('message', (raw) => socket.onmessage?.({ data: raw.toString() }))
  ws.on('close', () => socket.onclose?.())
  ws.on('error', () => socket.onerror?.())
  return socket
}
