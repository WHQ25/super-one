import type { PhoneConnection, PhoneLink } from './phone-endpoint'

/** Hold the first authenticated frames while the desktop domain opens, bounded and cancelled with the link. */
export function deferredPhoneConnection(link: PhoneLink, open: () => Promise<PhoneConnection>): PhoneConnection {
  let connection: PhoneConnection | null = null
  let closed = false
  let queued: Uint8Array[] = []
  let bytes = 0
  void open().then(current => {
    if (closed) { current.close(); return }
    connection = current
    const frames = queued; queued = []; bytes = 0
    for (const frame of frames) { if (closed) break; current.receive(frame) }
  }).catch(() => { if (!closed) { closed = true; queued = []; link.close(1011, 'desktop_domain_unavailable') } })
  return {
    receive(frame) {
      if (closed) return
      if (connection) { connection.receive(frame); return }
      bytes += frame.byteLength
      if (bytes > 4 * 1024 * 1024 || queued.length >= 64) { closed = true; queued = []; link.close(1009, 'phone_startup_buffer_full'); return }
      queued.push(frame.slice())
    },
    close() { closed = true; queued = []; connection?.close(); connection = null },
  }
}
