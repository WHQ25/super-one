import { afterEach, describe, expect, it, vi } from 'vitest'
import { RelayClient, type SocketLike } from './client'
import { TEST_LINK, completeHandshake, type TestHost } from './test-host-link'

class Socket implements SocketLike {
  sent: string[] = []
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null
  send(data: string) { this.sent.push(data) }
  close() { this.onclose?.() }
  emit(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }) }
}

const clients: RelayClient[] = []
afterEach(() => { for (const client of clients.splice(0)) client.disconnect() })
const hostInfo = { appVersion: '0.73.0-alpha.1', protocol: 3, environmentId: 'desk' }

async function connect(route: 'lan' | 'relay') {
  const socket = new Socket()
  const client = new RelayClient({ openSocket: () => { queueMicrotask(() => socket.onopen?.()); return socket } })
  clients.push(client)
  if (route === 'lan') await client.connectLan('127.0.0.1', 9876, TEST_LINK)
  else await client.connectRelay({ relayUrl: 'wss://relay.example', deviceId: 'phone', link: TEST_LINK })
  return { socket, client }
}

function reader(socket: Socket, host: TestHost) {
  let offset = 0
  return () => socket.sent.slice(offset, offset = socket.sent.length).flatMap((text) => {
    if (!text.startsWith('{')) return []
    const frame = JSON.parse(text) as { type: string; data?: string }
    if (frame.type !== 'command' || !frame.data) return []
    const message = host.openRpc(frame.data)
    return message ? [message] : []
  })
}

function negotiate(socket: Socket, host: TestHost, read: ReturnType<typeof reader>, environmentId = 'desk') {
  const handshake = read().at(-1)!
  expect(handshake).toMatchObject({ type: 'handshake', payload: { protocol: { current: 3 } } })
  host.sendRpc(socket, { type: 'handshake_ok', requestId: handshake.requestId, result: { protocol: 3, databaseSchema: 1, environmentId } }, { plain: true })
}

describe.each(['lan', 'relay'] as const)('phone protocol on %s', (route) => {
  it('reports a protocol-incompatible host as a concrete desktop upgrade', async () => {
    const { socket, client } = await connect(route)
    const pending = client.rpc('project.list')
    const rejected = expect(pending).rejects.toMatchObject({ code: 'desktop_upgrade_required', minimumVersion: '0.73.0-alpha.1' })
    const host = completeHandshake(socket, TEST_LINK, 'Desk', hostInfo)
    const handshake = reader(socket, host)().at(-1)!
    host.sendRpc(socket, { type: 'rpc_error', requestId: handshake.requestId, error: { code: 'protocol_incompatible', message: 'unsupported protocol generation' } }, { plain: true })
    await rejected
    expect(client.connected).toBe(false)
  })
  it('waits for both handshakes and sends a keyed native method envelope', async () => {
    const { socket, client } = await connect(route)
    const pending = client.rpc('session.send', { sessionId: 's', text: 'hi', leaseId: 'l', generation: '1' }, { idempotencyKey: 'send-1' })
    expect(socket.sent.filter((text) => text.includes('"command"'))).toEqual([])
    const host = completeHandshake(socket, TEST_LINK, 'Desk', hostInfo)
    const read = reader(socket, host)
    negotiate(socket, host, read)
    let requests: Record<string, unknown>[] = []
    await vi.waitFor(() => { requests = read(); expect(requests).toHaveLength(1) })
    const request = requests[0]!
    expect(request).toMatchObject({ type: 'rpc', method: 'session.send', environmentId: 'desk', protocolVersion: 3, idempotencyKey: 'send-1', payload: { sessionId: 's', leaseId: 'l' } })
    host.sendRpc(socket, { type: 'rpc_result', requestId: request.requestId, result: { accepted: true } })
    await expect(pending).resolves.toEqual({ accepted: true })
  })

  it('decodes fragmented results and dictionary-compressed pushes, including a push before subscribe receipt', async () => {
    const { socket, client } = await connect(route)
    const host = completeHandshake(socket, TEST_LINK, 'Desk', hostInfo)
    const read = reader(socket, host)
    negotiate(socket, host, read)
    const frames: unknown[] = []
    const ended = vi.fn()
    const subscribe = client.subscribeTopics({ afterSequence: '0', topics: [{ kind: 'session', environmentId: 'desk', sessionId: 's' }] }, { onFrame: (frame) => frames.push(frame), onEnd: ended })
    let requests: Record<string, unknown>[] = []
    await vi.waitFor(() => { requests = read(); expect(requests).toHaveLength(1) })
    const request = requests[0]!
    const subscriptionId = (request.payload as { subscriptionId: string }).subscriptionId
    for (const sequence of ['1', '2']) host.sendRpc(socket, { type: 'stream', subscriptionId, frame: { sequence, epoch: 'e', events: [] } }, { push: true })
    expect(frames).toEqual(['1', '2'].map((sequence) => ({ sequence, epoch: 'e', events: [] })))
    host.sendRpc(socket, { type: 'rpc_result', requestId: request.requestId, result: { subscriptionId } })
    await subscribe
    const loaded = client.rpc<{ text: string }>('session.load', { sessionId: 's' })
    await vi.waitFor(() => { requests = read(); expect(requests).toHaveLength(1) })
    let seed = 123
    const text = Array.from({ length: 700_000 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return String.fromCharCode(32 + (seed >>> 16) % 95) }).join('')
    host.sendRpc(socket, { type: 'rpc_result', requestId: requests[0]!.requestId, result: { text } })
    await expect(loaded).resolves.toEqual({ text })
    client.disconnect()
    expect(ended).toHaveBeenCalledOnce()
  })

  it('rejects a missing host contract without probing or sending an application command', async () => {
    const { socket, client } = await connect(route)
    const pending = client.rpc('session.load', { sessionId: 's' })
    completeHandshake(socket)
    await expect(pending).rejects.toMatchObject({ code: 'desktop_upgrade_required' })
    expect(socket.sent.filter((text) => text.includes('"command"'))).toEqual([])
  })

  it('rejects the connection when the protocol handshake changes the authenticated environment', async () => {
    const { socket, client } = await connect(route)
    const pending = client.rpc('session.load', { sessionId: 's' })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'identity_conflict' })
    const host = completeHandshake(socket, TEST_LINK, 'Desk', hostInfo)
    negotiate(socket, host, reader(socket, host), 'other-desk')
    await rejected
    expect(client.connected).toBe(false)
  })
})
