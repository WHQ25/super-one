import { afterEach, describe, expect, it, vi } from 'vitest'
import { RelayClient, type SocketLike } from './client'
import { LINK_CHANNEL_FRAME, sealLinkFrame } from './phone-link'
import { encodePlainMessage } from '@superone/shared/environment/wire'
import { issueChannelCredential } from './secure-channel'
import { TEST_LINK, TEST_ROOT_SECRET, NATIVE_TEST_HOST, completeHandshake, completeNativeHandshake } from './test-host-link'

const RELAY = { relayUrl: 'wss://relay.example', link: TEST_LINK, deviceId: 'dev-1' }
class MockSocket implements SocketLike {
  sent: string[] = []
  closed = false
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null
  send(data: string) { this.sent.push(data) }
  close() { this.closed = true; this.onclose?.() }
  emit(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }) }
}
const clients: RelayClient[] = []
afterEach(() => { for (const client of clients.splice(0)) client.disconnect() })
function fixture(hooks: ConstructorParameters<typeof RelayClient>[0] = {}) {
  const sockets: MockSocket[] = []
  const client = new RelayClient({ ...hooks, openSocket: () => {
    const socket = new MockSocket(); sockets.push(socket)
    queueMicrotask(() => socket.onopen?.())
    return socket
  } })
  clients.push(client)
  return { client, sockets }
}

describe('native RelayClient socket adapter', () => {
  it('probes a foreground relay socket once and resolves false when it closes', async () => {
    const { client, sockets } = fixture()
    await client.connectRelay(RELAY)
    const socket = sockets[0]!
    const probe = client.probeConnection()
    expect(client.probeConnection()).toBe(probe)
    expect(socket.sent.at(-1)).toBe('ping')
    socket.onmessage?.({ data: 'pong' })
    await expect(probe).resolves.toBe(true)
    const lost = client.probeConnection(); client.disconnect()
    await expect(lost).resolves.toBe(false)
  })
  it('waits for the native handshake, coalesces reads and buffers native client pushes', async () => {
    const onEvents = vi.fn(), onControl = vi.fn()
    const { client, sockets } = fixture({ onEvents, onControl })
    await client.connectRelay(RELAY)
    const socket = sockets[0]!
    const first = client.rpc('project.list')
    const second = client.rpc('project.list')
    expect(socket.sent.some(raw => raw.includes('"command"'))).toBe(false)
    const host = completeHandshake(socket, TEST_LINK, 'Desk', NATIVE_TEST_HOST)
    const handshake = host.readRpc(socket).at(-1)!
    expect(onControl).not.toHaveBeenCalled()
    expect(host.readRpc(socket)).toEqual([])
    host.sendRpc(socket, { type: 'handshake_ok', requestId: handshake.requestId,
      result: { protocol: 3, databaseSchema: 1, environmentId: 'desk' } }, { plain: true })
    await client.verifyHost()
    let requests: Record<string, unknown>[] = []
    await vi.waitFor(() => { requests.push(...host.readRpc(socket)); expect(requests).toHaveLength(1) })
    expect(requests[0]).toMatchObject({ type: 'rpc', method: 'project.list' })
    host.sendRpc(socket, { type: 'rpc_result', requestId: requests[0]!.requestId, result: { projects: [] } })
    await expect(first).resolves.toEqual({ projects: [] }); await expect(second).resolves.toEqual({ projects: [] })
    client.startBuffering()
    const event = { type: 'composer_settled', formId: 'form', outcome: 'sent' }
    host.sendRpc(socket, { type: 'client', event }, { push: true })
    expect(onEvents).not.toHaveBeenCalled()
    expect(client.releaseBuffer().batches).toEqual([[event]])
  })
  it('delivers private voice signaling immediately without retaining it in the restore buffer', async () => {
    const onArrived = vi.fn(), onEvents = vi.fn()
    const { client, sockets } = fixture({ onArrived, onEvents })
    await client.connectRelay(RELAY)
    const socket = sockets[0]!
    const host = completeNativeHandshake(socket, TEST_LINK, 'desk')
    await client.verifyHost()
    client.startBuffering()
    const event = { type: 'realtime_call_signal', sessionId: 's', projectPath: '/repo', signal: { kind: 'answer', sdp: 'private-answer' } }
    host.sendRpc(socket, { type: 'client', event }, { push: true })
    expect(onArrived).toHaveBeenCalledWith([event])
    expect(onEvents).not.toHaveBeenCalled()
    expect(client.releaseBuffer().batches).toEqual([])
  })
  it('follows a handshake restart while a read is still waiting for the channel', async () => {
    const { client, sockets } = fixture()
    await client.connectRelay(RELAY)
    const socket = sockets[0]!
    const pending = client.rpc('environment.list')
    socket.emit({ type: 'peer_connected' })
    const host = completeNativeHandshake(socket, TEST_LINK, 'desk')
    await client.verifyHost()
    let request!: Record<string, unknown>
    await vi.waitFor(() => { request = host.replyRpc(socket, { environments: [] }) })
    expect(request).toMatchObject({ type: 'rpc', method: 'environment.list' })
    await expect(pending).resolves.toEqual({ environments: [] })
  })
  it('cancels a read already on the wire when the handshake restarts', async () => {
    const { client, sockets } = fixture()
    await client.connectRelay(RELAY)
    const socket = sockets[0]!
    const host = completeNativeHandshake(socket, TEST_LINK, 'desk')
    await client.verifyHost()
    const pending = client.rpc('environment.list')
    const rejected = expect(pending).rejects.toThrow('channel restarted')
    await vi.waitFor(() => {
      expect(host.readRpc(socket).some(request => request.method === 'environment.list')).toBe(true)
    })
    socket.emit({ type: 'peer_connected' })
    await rejected
  })
  it('stops the local wait when the caller aborts', async () => {
    const { client, sockets } = fixture()
    await client.connectRelay(RELAY)
    completeNativeHandshake(sockets[0]!)
    await client.verifyHost()
    const controller = new AbortController()
    const pending = client.rpc('environment.list', {}, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('reruns both handshakes for a returning desktop and reports only verified host contracts', async () => {
    const onControl = vi.fn()
    const { client, sockets } = fixture({ onControl })
    await client.connectRelay(RELAY)
    const socket = sockets[0]!
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ type: LINK_CHANNEL_FRAME, msg: { type: 'channel_hello', keyId: TEST_LINK.credential.keyId } })
    expect(socket.sent.join('')).not.toContain(TEST_LINK.credential.secretHex)
    completeNativeHandshake(socket, TEST_LINK, 'desktop'); await client.verifyHost()
    socket.emit({ type: 'peer_disconnected' }); socket.emit({ type: 'peer_connected' })
    completeNativeHandshake(socket, TEST_LINK, 'desktop'); await client.verifyHost()
    expect(onControl.mock.calls.map(([frame]) => frame.type)).toEqual(['handshake', 'peer_disconnected', 'peer_connected', 'handshake'])
    expect(socket.sent.filter(raw => raw.includes('channel_hello'))).toHaveLength(2)
  })
  it('ignores a stale challenge and drops a host that cannot prove its pairing secret', async () => {
    const onStatus = vi.fn()
    const { client, sockets } = fixture({ onStatus })
    await client.connectRelay(RELAY)
    const socket = sockets[0]!
    socket.emit({ type: LINK_CHANNEL_FRAME, msg: { type: 'channel_challenge', v: 1, nonce: 'aa'.repeat(32), proof: 'bb'.repeat(32) }, hello: 'stale' })
    expect(socket.sent.some(raw => raw.includes('channel_proof'))).toBe(false)
    const wrong = issueChannelCredential(TEST_ROOT_SECRET, 'wrong-key')
    expect(() => completeHandshake(socket, { credential: { ...wrong, keyId: TEST_LINK.credential.keyId }, roomId: TEST_LINK.roomId })).toThrow('no channel proof sent')
    expect(onStatus.mock.calls.map(([status]) => status)).toEqual([true, false])
  })
  it('probes LAN through environment.health on the native connection', async () => {
    const { client, sockets } = fixture()
    await client.connectLan('192.0.2.1', 7788, TEST_LINK)
    const host = completeNativeHandshake(sockets[0]!); await client.verifyHost()
    const probe = client.probeConnection()
    let request!: Record<string, unknown>
    await vi.waitFor(() => { request = host.replyRpc(sockets[0]!, { ok: true }) })
    expect(request).toMatchObject({ type: 'rpc', method: 'environment.health' })
    await expect(probe).resolves.toBe(true)
  })
  it('replaces sockets exclusively and ignores the old socket callback', async () => {
    const onEvents = vi.fn(), onStatus = vi.fn()
    const { client, sockets } = fixture({ onEvents, onStatus })
    await client.connectRelay(RELAY)
    const first = completeNativeHandshake(sockets[0]!); await client.verifyHost()
    const oldMessage = sockets[0]!.onmessage
    const stale = sealLinkFrame(first.channel, { t: 'rpc' }, encodePlainMessage({ type: 'client', event: { type: 'composer_settled', formId: 'old' } }))
    await client.connectLan('192.0.2.1', 7788, TEST_LINK)
    expect(sockets[0]!.closed).toBe(true)
    const host = completeNativeHandshake(sockets[1]!); await client.verifyHost()
    oldMessage?.({ data: JSON.stringify({ type: 'terminal', data: stale }) })
    const event = { type: 'composer_settled', formId: 'new' }
    host.sendRpc(sockets[1]!, { type: 'client', event }, { push: true })
    expect(onEvents).toHaveBeenCalledExactlyOnceWith([event], 0)
    expect(client.transport).toBe('lan')
    expect(onStatus.mock.calls.map(([status]) => status)).toEqual([true, true])
  })
  it('reconnects with a fresh buffered channel and never replays application envelopes', async () => {
    const { client, sockets } = fixture()
    await client.connectRelay(RELAY)
    completeNativeHandshake(sockets[0]!); await client.verifyHost()
    await client.reconnect()
    const host = completeNativeHandshake(sockets[1]!); await client.verifyHost()
    const event = { type: 'composer_settled', formId: 'returned' }
    host.sendRpc(sockets[1]!, { type: 'client', event }, { push: true })
    expect(client.releaseBuffer().batches).toEqual([[event]])
    expect(sockets.flatMap(socket => socket.sent).some(raw => raw.includes('"replay"') || raw.includes('"ack"'))).toBe(false)
  })
  it('rejects a replayed authenticated native packet rather than delivering it twice', async () => {
    const onEvents = vi.fn()
    const { client, sockets } = fixture({ onEvents })
    await client.connectRelay(RELAY)
    const host = completeNativeHandshake(sockets[0]!); await client.verifyHost()
    const data = sealLinkFrame(host.channel, { t: 'rpc' }, encodePlainMessage({ type: 'client', event: { type: 'composer_settled', formId: 'once' } }))
    sockets[0]!.emit({ type: 'terminal', data }); sockets[0]!.emit({ type: 'terminal', data })
    expect(onEvents).toHaveBeenCalledTimes(1)
    expect(client.connected).toBe(false)
  })
  it('fails a pending native receipt on malformed ciphertext and refuses an application frame on the wrong lane', async () => {
    const { client, sockets } = fixture()
    await client.connectRelay(RELAY)
    completeNativeHandshake(sockets[0]!); await client.verifyHost()
    const pending = client.rpc('project.list')
    const rejected = expect(pending).rejects.toBeInstanceOf(Error)
    sockets[0]!.emit({ type: 'terminal', data: 'invalid' })
    await rejected
    expect(client.connected).toBe(false)
    await client.reconnect()
    const host = completeNativeHandshake(sockets[1]!); await client.verifyHost()
    sockets[1]!.emit({ type: 'terminal', data: 'invalid-native-frame' })
    expect(client.connected).toBe(false)
  })
  it('keeps call retention across a new channel while retiring old navigation references', async () => {
    const { client, sockets } = fixture()
    await client.connectRelay(RELAY)
    completeNativeHandshake(sockets[0]!); await client.verifyHost()
    const ref = { environmentId: 'desk', sessionId: 's' }
    const release = vi.spyOn(client, 'releaseControl').mockResolvedValue()
    const oldChat = client.retainSession(ref)
    const call = client.retainSession(ref, { acrossReconnect: true })
    await client.reconnect()
    completeNativeHandshake(sockets[1]!); await client.verifyHost()
    const newChat = client.retainSession(ref)
    await oldChat(); await newChat()
    expect(release).not.toHaveBeenCalled()
    await call(); await call()
    expect(release).toHaveBeenCalledTimes(1)
  })
  it('downloads a LAN file using the connected host', async () => {
    const { client } = fixture()
    await client.connectLan('192.0.2.1', 7788, TEST_LINK)
    const bytes = new TextEncoder().encode('png')
    const get = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer }))
    await expect(client.downloadDesktopFile({ ok: true, url: 'http://{lanHost}:7788/files/token', name: 'shot.png', mimeType: 'image/png', size: bytes.length, modifiedAt: 1, expiresAt: Date.now() + 60_000 }, get)).resolves.toEqual(bytes)
    expect(get).toHaveBeenCalledWith('http://192.0.2.1:7788/files/token')
  })
})
