import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RelaySession } from './relay-session'
import { createMockState, createMockWebSocket } from './test-durable-object'

describe('RelaySession', () => {
  let state: ReturnType<typeof createMockState>
  let session: RelaySession
  let desktopWs: ReturnType<typeof createMockWebSocket>
  let mobileWs: ReturnType<typeof createMockWebSocket>

  beforeEach(() => {
    state = createMockState()
    session = new RelaySession(state as any, {} as any)
    desktopWs = createMockWebSocket()
    mobileWs = createMockWebSocket()
    state.acceptWebSocket(desktopWs, ['desktop'])
    state.acceptWebSocket(mobileWs, ['mobile:dev-1'])
  })

  it('forwards event from desktop to mobile with seq', async () => {
    await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'encrypted123' }))
    expect(mobileWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'event', seq: 1, data: 'encrypted123' }))
  })

  it('increments seq for each event', async () => {
    await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'a' }))
    await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'b' }))
    expect(mobileWs.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'event', seq: 2, data: 'b' }))
  })

  it('forwards command from mobile to desktop, injecting senderDeviceId', async () => {
    await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'command', data: 'cmd123' }))
    expect(desktopWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'command', data: 'cmd123', mobileDeviceId: 'dev-1' }))
  })

  it('forwards register from mobile to desktop', async () => {
    const frame = { type: 'register', deviceName: 'Phone', mobileDeviceId: 'dev-1' }
    await session.webSocketMessage(mobileWs as any, JSON.stringify(frame))
    expect(desktopWs.send).toHaveBeenCalledWith(JSON.stringify(frame))
  })

  it('forwards response from desktop to all mobiles', async () => {
    const frame = { type: 'response', requestId: 'r1', data: 'enc' }
    await session.webSocketMessage(desktopWs as any, JSON.stringify(frame))
    expect(mobileWs.send).toHaveBeenCalledWith(JSON.stringify(frame))
  })

  it('forwards handshake from desktop to all mobiles', async () => {
    const frame = { type: 'handshake', hostName: 'MyMac' }
    await session.webSocketMessage(desktopWs as any, JSON.stringify(frame))
    expect(mobileWs.send).toHaveBeenCalledWith(JSON.stringify(frame))
  })

  it('keeps nothing to replay: an ACK is a no-op and a replay request gets reset', async () => {
    await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'x' }))
    await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'ack', seq: 1 }))
    mobileWs.send.mockClear()
    await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'replay', fromSeq: 1 }))
    expect(mobileWs.send.mock.calls).toEqual([[JSON.stringify({ type: 'reset' })]])
    expect(state.storage.put).not.toHaveBeenCalled()
  })

  it('broadcasts desktop_shutdown to all mobiles', async () => {
    const mobile2 = createMockWebSocket()
    state.acceptWebSocket(mobile2, ['mobile:dev-2'])
    for (let i = 0; i < 3; i++) {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: `e${i}` }))
    }
    mobileWs.send.mockClear()
    mobile2.send.mockClear()

    await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'desktop_shutdown' }))

    const payload = JSON.stringify({ type: 'desktop_shutdown' })
    expect(mobileWs.send).toHaveBeenCalledWith(payload)
    expect(mobile2.send).toHaveBeenCalledWith(payload)
  })

  it('sends peer_disconnected to all mobiles when desktop closes', async () => {
    desktopWs.readyState = WebSocket.CLOSED
    await session.webSocketClose(desktopWs as any)
    expect(mobileWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'peer_disconnected' }))
  })

  it('sends per-device peer_disconnected to desktop when a mobile closes', async () => {
    mobileWs.readyState = WebSocket.CLOSED
    await session.webSocketClose(mobileWs as any)
    expect(desktopWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'peer_disconnected', mobileDeviceId: 'dev-1' }))
  })

  it('silently drops messages when peer is not connected', async () => {
    const lonelyState = createMockState()
    const lonelySession = new RelaySession(lonelyState as any, {} as any)
    const ws = createMockWebSocket()
    lonelyState.acceptWebSocket(ws, ['mobile:dev-1'])
    await lonelySession.webSocketMessage(ws as any, JSON.stringify({ type: 'command', data: 'test' }))
  })

  it('ignores non-string messages', async () => {
    await session.webSocketMessage(desktopWs as any, new ArrayBuffer(8))
    expect(mobileWs.send).not.toHaveBeenCalled()
  })

  it('ignores invalid JSON', async () => {
    await session.webSocketMessage(desktopWs as any, 'not-json')
    expect(mobileWs.send).not.toHaveBeenCalled()
  })

  describe('replaced sockets that never finish closing', () => {
    it('routes mobile commands to the redialled desktop, not the CLOSING one it replaced', async () => {
      const fresh = createMockWebSocket()
      desktopWs.close(1000, 'replaced')
      state.acceptWebSocket(fresh, ['desktop'])
      await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'command', data: 'enc' }))
      expect(fresh.send).toHaveBeenCalledWith(JSON.stringify({ type: 'command', data: 'enc', mobileDeviceId: 'dev-1' }))
      expect(desktopWs.send).not.toHaveBeenCalled()
    })

    it('reports /status from the live desktop even while the stale one lingers', async () => {
      const fresh = createMockWebSocket()
      desktopWs.close(1000, 'replaced')
      state.acceptWebSocket(fresh, ['desktop'])
      state.getWebSocketAutoResponseTimestamp.mockImplementation((ws: object) =>
        ws === desktopWs ? new Date(Date.now() - 600_000) : null)
      const res = await session.fetch(new Request('https://internal/status'))
      expect(await res.json()).toEqual({ desktop: true })
    })

    it('does not announce peer_disconnected when the replaced desktop socket closes late', async () => {
      desktopWs.close(1000, 'replaced')
      state.acceptWebSocket(createMockWebSocket(), ['desktop'])
      await session.webSocketClose(desktopWs as any)
      expect(mobileWs.send).not.toHaveBeenCalled()
    })

    it('does not mark a mobile offline when its replaced socket closes late', async () => {
      mobileWs.close(1000, 'replaced')
      state.acceptWebSocket(createMockWebSocket(), ['mobile:dev-1'])
      await session.webSocketClose(mobileWs as any)
      expect(desktopWs.send).not.toHaveBeenCalled()
    })

    it('still announces peer_disconnected when the only desktop closes', async () => {
      desktopWs.close(1000, 'gone')
      await session.webSocketClose(desktopWs as any)
      expect(mobileWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'peer_disconnected' }))
    })

    it('broadcasts and targeted delivery agree on which of two OPEN sockets is a device', async () => {
      // Residue of the old selector: two OPEN sockets carrying the same device tag.
      const newer = createMockWebSocket()
      state.acceptWebSocket(newer, ['mobile:dev-1'])
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'handshake', hostName: 'desk' }))
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'enc', targets: ['dev-1'] }))
      expect(newer.send).toHaveBeenCalledTimes(2)
      expect(mobileWs.send).not.toHaveBeenCalled()
    })

    it('delivers desktop events to the live socket of a mobile that redialled', async () => {
      const fresh = createMockWebSocket()
      mobileWs.close(1000, 'replaced')
      state.acceptWebSocket(fresh, ['mobile:dev-1'])
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'enc' }))
      expect(fresh.send).toHaveBeenCalledTimes(1)
      expect(mobileWs.send).not.toHaveBeenCalled()
    })
  })

  describe('idle alarm', () => {
    it('re-arms instead of tearing down while the desktop heartbeat is fresh', async () => {
      state.getWebSocketAutoResponseTimestamp.mockReturnValue(new Date(Date.now() - 5_000))
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'enc' }))
      state.storage.setAlarm.mockClear()
      await session.alarm()
      expect(desktopWs.close).not.toHaveBeenCalled()
      expect(mobileWs.close).not.toHaveBeenCalled()
      expect(state.storage.setAlarm).toHaveBeenCalledTimes(1)
    })

    it('tears down a desktop whose heartbeat lapsed, even though its socket is still listed', async () => {
      state.getWebSocketAutoResponseTimestamp.mockReturnValue(new Date(Date.now() - 70_000))
      await session.alarm()
      expect(desktopWs.close).toHaveBeenCalledWith(1000, 'idle_timeout')
    })

    it('tears down a desktop that never pinged, as before the heartbeat existed', async () => {
      state.getWebSocketAutoResponseTimestamp.mockReturnValue(null)
      await session.alarm()
      expect(desktopWs.close).toHaveBeenCalledWith(1000, 'idle_timeout')
      expect(mobileWs.close).toHaveBeenCalledWith(1000, 'idle_timeout')
    })
  })

  describe('/status presence', () => {
    const status = async () => {
      const res = await session.fetch(new Request('https://internal/status'))
      return (await res.json()) as { desktop: boolean }
    }

    it('reports the desktop online while its heartbeat is fresh', async () => {
      state.getWebSocketAutoResponseTimestamp.mockReturnValue(new Date(Date.now() - 20_000))
      expect(await status()).toEqual({ desktop: true })
    })

    it('reports online for a desktop that has not pinged yet — freshly attached or pre-heartbeat', async () => {
      state.getWebSocketAutoResponseTimestamp.mockReturnValue(null)
      expect(await status()).toEqual({ desktop: true })
    })

    it('reports a half-open desktop socket offline once its heartbeat lapses', async () => {
      state.getWebSocketAutoResponseTimestamp.mockReturnValue(new Date(Date.now() - 90_000))
      expect(await status()).toEqual({ desktop: false })
    })

    it('reports offline when no desktop socket is attached', async () => {
      const lonely = createMockState()
      const lonelySession = new RelaySession(lonely as any, {} as any)
      lonely.acceptWebSocket(createMockWebSocket(), ['mobile:dev-1'])
      const res = await lonelySession.fetch(new Request('https://internal/status'))
      expect(await res.json()).toEqual({ desktop: false })
    })
  })

  describe('legacy envelope seq', () => {
    it('survives hibernation with the socket, so a revived session continues it', async () => {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'a' }))
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'b' }))
      const revived = new RelaySession(state as any, {} as any)
      await revived.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'after-hibernate' }))
      expect(mobileWs.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'event', seq: 3, data: 'after-hibernate' }))
    })

    it('starts over on a redialled socket', async () => {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'a' }))
      const fresh = createMockWebSocket()
      mobileWs.close(1000, 'replaced')
      state.acceptWebSocket(fresh, ['mobile:dev-1'])
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'b' }))
      expect(fresh.send).toHaveBeenCalledWith(JSON.stringify({ type: 'event', seq: 1, data: 'b' }))
    })
  })

  describe('multi-mobile per channel', () => {
    let mobileB: ReturnType<typeof createMockWebSocket>

    beforeEach(() => {
      mobileB = createMockWebSocket()
      state.acceptWebSocket(mobileB, ['mobile:dev-2'])
    })

    it('broadcasts events from desktop to every connected mobile', async () => {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'broadcast' }))
      expect(mobileWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'event', seq: 1, data: 'broadcast' }))
      expect(mobileB.send).toHaveBeenCalledWith(JSON.stringify({ type: 'event', seq: 1, data: 'broadcast' }))
    })

    it('command from mobileA tagged with senderDeviceId, mobileB receives nothing', async () => {
      await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'command', data: 'cmd-A' }))
      expect(desktopWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'command', data: 'cmd-A', mobileDeviceId: 'dev-1' }))
      expect(mobileB.send).not.toHaveBeenCalled()
    })

    it('command from mobileB tagged with its own senderDeviceId', async () => {
      await session.webSocketMessage(mobileB as any, JSON.stringify({ type: 'command', data: 'cmd-B' }))
      expect(desktopWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'command', data: 'cmd-B', mobileDeviceId: 'dev-2' }))
    })

    it('one mobile disconnect only notifies desktop with that mobile id; other mobile unaffected', async () => {
      mobileWs.readyState = WebSocket.CLOSED
      await session.webSocketClose(mobileWs as any)
      expect(desktopWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'peer_disconnected', mobileDeviceId: 'dev-1' }))
      expect(mobileB.send).not.toHaveBeenCalled()
    })

    it('channel handshake frames: stamped with the sender, routed to one mobile', async () => {
      const hello = { type: 'channel', msg: { type: 'channel_hello', v: 1, keyId: 'k', nonce: 'n' }, mobileDeviceId: 'dev-2' }
      // A sender cannot claim another device's slot: the relay overwrites the id.
      await session.webSocketMessage(mobileWs as any, JSON.stringify(hello))
      expect(desktopWs.send).toHaveBeenCalledWith(JSON.stringify({ ...hello, mobileDeviceId: 'dev-1' }))

      const challenge = { type: 'channel', mobileDeviceId: 'dev-2', msg: { type: 'channel_challenge' }, hello: 'n' }
      await session.webSocketMessage(desktopWs as any, JSON.stringify(challenge))
      expect(mobileB.send).toHaveBeenCalledWith(JSON.stringify(challenge))
      expect(mobileWs.send).not.toHaveBeenCalled()

      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'channel', data: 'sealed' }))
      expect(mobileB.send).toHaveBeenCalledTimes(1)
    })

    it('node channel slots: chunked frames and a coded close pass through unchanged', async () => {
      // A desktop node (runtime relay-node-link.ts) gives every connection its own slot.
      const node = createMockWebSocket()
      const slot = createMockWebSocket()
      state.acceptWebSocket(node, ['desktop'])
      state.acceptWebSocket(slot, ['mobile:node-1'])
      const part = { type: 'channel', data: 'QUJD', more: true }
      await session.webSocketMessage(slot as any, JSON.stringify(part))
      expect(node.send).toHaveBeenCalledWith(JSON.stringify({ ...part, mobileDeviceId: 'node-1' }))

      const reply = { type: 'channel', data: 'REVG', more: true, mobileDeviceId: 'node-1' }
      await session.webSocketMessage(node as any, JSON.stringify(reply))
      expect(slot.send).toHaveBeenCalledWith(JSON.stringify(reply))
      const close = { type: 'kicked', mobileDeviceId: 'node-1', code: 4401, reason: 'channel_auth_failed' }
      await session.webSocketMessage(node as any, JSON.stringify(close))
      expect(slot.send).toHaveBeenLastCalledWith(JSON.stringify(close))
      expect(mobileWs.send).not.toHaveBeenCalled()
    })

    it('kicked frame from desktop targets only the matching mobile', async () => {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'kicked', mobileDeviceId: 'dev-2' }))
      expect(mobileB.send).toHaveBeenCalledWith(JSON.stringify({ type: 'kicked', mobileDeviceId: 'dev-2' }))
      expect(mobileWs.send).not.toHaveBeenCalled()
    })

    it('event with targets routes only to listed mobile devices', async () => {
      await session.webSocketMessage(
        desktopWs as any,
        JSON.stringify({ type: 'event', data: 'only-for-1', targets: ['dev-1'] }),
      )
      expect(mobileWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'event', seq: 1, data: 'only-for-1' }))
      expect(mobileB.send).not.toHaveBeenCalled()
    })

    it('event without targets falls back to broadcasting to all mobiles', async () => {
      await session.webSocketMessage(
        desktopWs as any,
        JSON.stringify({ type: 'event', data: 'global' }),
      )
      expect(mobileWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'event', seq: 1, data: 'global' }))
      expect(mobileB.send).toHaveBeenCalledWith(JSON.stringify({ type: 'event', seq: 1, data: 'global' }))
    })

    it('event with targets routes to multiple listed mobiles', async () => {
      const mobileC = createMockWebSocket()
      state.acceptWebSocket(mobileC, ['mobile:dev-3'])
      await session.webSocketMessage(
        desktopWs as any,
        JSON.stringify({ type: 'event', data: 'two-of-three', targets: ['dev-1', 'dev-3'] }),
      )
      expect(mobileWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'event', seq: 1, data: 'two-of-three' }))
      expect(mobileC.send).toHaveBeenCalledWith(JSON.stringify({ type: 'event', seq: 1, data: 'two-of-three' }))
      expect(mobileB.send).not.toHaveBeenCalled()
    })
  })

  describe('per-phone delivery', () => {
    let mobileB: ReturnType<typeof createMockWebSocket>

    beforeEach(() => {
      mobileB = createMockWebSocket()
      state.acceptWebSocket(mobileB, ['mobile:dev-2'])
    })

    it('numbers each phone\'s events contiguously, however broadcasts and targeted events interleave', async () => {
      const send = (frame: object) => session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', ...frame }))
      await send({ data: 'a-only', targets: ['dev-1'] })
      await send({ data: 'b-only', targets: ['dev-2'] })
      await send({ data: 'broadcast' })
      await send({ data: 'both', targets: ['dev-1', 'dev-2', 'dev-1'] })
      await send({ data: 'offline', targets: ['dev-3'] })
      const seen = (ws: typeof mobileWs) => ws.send.mock.calls.map((c: string[]) => JSON.parse(c[0])).map((c: { seq: number; data: string }) => [c.seq, c.data])
      expect(seen(mobileWs)).toEqual([[1, 'a-only'], [2, 'broadcast'], [3, 'both']])
      expect(seen(mobileB)).toEqual([[1, 'b-only'], [2, 'broadcast'], [3, 'both']])
    })

    it('response with mobileDeviceId routes to that mobile only', async () => {
      const frame = { type: 'response', requestId: 'r1', data: 'enc', mobileDeviceId: 'dev-2' }
      await session.webSocketMessage(desktopWs as any, JSON.stringify(frame))
      expect(mobileB.send).toHaveBeenCalledWith(JSON.stringify(frame))
      expect(mobileWs.send).not.toHaveBeenCalled()
    })

    it('response without mobileDeviceId still broadcasts (back-compat)', async () => {
      const frame = { type: 'response', requestId: 'r1', data: 'enc' }
      await session.webSocketMessage(desktopWs as any, JSON.stringify(frame))
      expect(mobileWs.send).toHaveBeenCalledWith(JSON.stringify(frame))
      expect(mobileB.send).toHaveBeenCalledWith(JSON.stringify(frame))
    })
  })
})

describe('RelaySession terminal frames (non-buffered)', () => {
  let state: ReturnType<typeof createMockState>
  let session: RelaySession
  let desktopWs: ReturnType<typeof createMockWebSocket>
  let mobileA: ReturnType<typeof createMockWebSocket>
  let mobileB: ReturnType<typeof createMockWebSocket>

  beforeEach(() => {
    state = createMockState()
    session = new RelaySession(state as any, {} as any)
    desktopWs = createMockWebSocket()
    mobileA = createMockWebSocket()
    mobileB = createMockWebSocket()
    state.acceptWebSocket(desktopWs, ['desktop'])
    state.acceptWebSocket(mobileA, ['mobile:dev-a'])
    state.acceptWebSocket(mobileB, ['mobile:dev-b'])
  })

  it('forwards a terminal frame verbatim to targeted mobile only, without a seq', async () => {
    const frame = { type: 'terminal', data: 'enc-term', targets: ['dev-a'] }
    await session.webSocketMessage(desktopWs as any, JSON.stringify(frame))
    expect(mobileA.send).toHaveBeenCalledWith(JSON.stringify(frame))
    expect(mobileB.send).not.toHaveBeenCalled()
  })

  it('broadcasts a terminal frame to all mobiles when no targets', async () => {
    const frame = { type: 'terminal', data: 'enc-term' }
    await session.webSocketMessage(desktopWs as any, JSON.stringify(frame))
    expect(mobileA.send).toHaveBeenCalledWith(JSON.stringify(frame))
    expect(mobileB.send).toHaveBeenCalledWith(JSON.stringify(frame))
  })

  it('a terminal flood does not advance the event seq', async () => {
    for (let i = 0; i < 600; i++) {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'terminal', data: `t${i}` }))
    }
    await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'real' }))
    expect(mobileA.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'event', seq: 1, data: 'real' }))
  })
})
