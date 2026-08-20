import { describe, expect, it } from 'vitest'
import { deriveKeys, encryptPayload } from './crypto'
import { RelayClient, type SocketLike } from './client'
import { restoreSession } from './restore'

const MASTER = '0123456789abcdef'.repeat(8)

class MockSocket implements SocketLike {
  sent: string[] = []
  onopen: ((ev?: unknown) => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev?: unknown) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.onclose?.()
  }
  emit(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) })
  }
}

describe('RelayClient', () => {
  it('connects, requests RPC, and applies buffered events after restore', async () => {
    let sock: MockSocket | null = null
    const events: unknown[][] = []
    const client = new RelayClient({
      openSocket: () => {
        sock = new MockSocket()
        queueMicrotask(() => sock?.onopen?.())
        return sock
      },
      onEvents: (batch) => events.push(batch),
    })
    await client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER, deviceId: 'd1' })
    expect(sock).not.toBeNull()
    expect(sock!.sent.some((s) => s.includes('"replay"'))).toBe(true)

    client.startBuffering()
    const keys = deriveKeys(MASTER)
    const live = encryptPayload(keys.aesKeyBytes, { type: 'status_change', status: 'idle' })
    sock!.emit({ type: 'event', seq: 1, data: live })
    expect(events).toEqual([])

    const reqP = client.request({ type: 'list_projects', requestId: 'r1' })
    const cmd = JSON.parse(sock!.sent.find((s) => s.includes('"command"'))!)
    const payload = encryptPayload(keys.aesKeyBytes, { projects: [{ path: '/p', name: 'p' }] })
    sock!.emit({ type: 'response', requestId: 'r1', data: payload })
    await expect(reqP).resolves.toEqual({ projects: [{ path: '/p', name: 'p' }] })

    const released = client.releaseBuffer()
    expect(released.epoch).toBe(1)
    expect(released.batches).toHaveLength(1)
  })

  it('restoreSession is subscribe → history → snapshot → release', async () => {
    let sock: MockSocket | null = null
    const client = new RelayClient({
      openSocket: () => {
        sock = new MockSocket()
        queueMicrotask(() => sock?.onopen?.())
        return sock
      },
    })
    await client.connectRelay({ relayUrl: 'wss://relay.example', masterSecret: MASTER })
    const keys = deriveKeys(MASTER)
    const restoreP = restoreSession(client, '/proj', 'sess-1')
    await Promise.resolve()
    const reply = async (body: unknown) => {
      const last = sock!.sent.filter((s) => s.includes('"command"')).at(-1)!
      const frame = JSON.parse(last) as { data: string }
      const cmd = (await import('./crypto')).decryptPayload(keys.aesKeyBytes, frame.data) as { requestId: string }
      sock!.emit({ type: 'response', requestId: cmd.requestId, data: encryptPayload(keys.aesKeyBytes, body) })
    }
    await reply({ ok: true })
    await reply({ messages: [{ id: 'm1', role: 'user', status: 'complete', content: [], createdAt: '', providerId: 'claude' }], hasMore: false, cursor: null })
    await reply({ status: 'idle', pendingInteractions: [], inProgressMessages: [] })
    const restored = await restoreP
    expect(restored.messages).toHaveLength(1)
    expect(restored.snapshot.status).toBe('idle')
  })
})
