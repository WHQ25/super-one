import type { PairRoomSocket } from './pair-room'

/** A pairing-room socket whose sends go straight to the other role. */
export class FakePairRoomSocket implements PairRoomSocket {
  closed = false
  onopen: ((ev?: unknown) => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev?: unknown) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null
  constructor(private readonly deliver: (data: string) => void) {}
  send(data: string) {
    if (!this.closed) this.deliver(data)
  }
  close() {
    this.closed = true
  }
}

/** The relay's pairing room for tests: one `desktop` and one `mobile` socket. */
export function fakePairRoom() {
  const sockets: Record<'desktop' | 'mobile', FakePairRoomSocket | null> = { desktop: null, mobile: null }
  const open = (url: string): FakePairRoomSocket => {
    const role = new URL(url).searchParams.get('role') as 'desktop' | 'mobile'
    const socket = new FakePairRoomSocket((data) => sockets[role === 'desktop' ? 'mobile' : 'desktop']?.onmessage?.({ data }))
    sockets[role] = socket
    return socket
  }
  return { open, sockets }
}
