import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RelaySession } from './relay-session'

function createMockWebSocket() {
  const ws = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    // Like the runtime: close() moves to CLOSING, and the socket stays listed
    // until the close handshake completes — which a half-open link never does.
    close: vi.fn((_code?: number, _reason?: string) => { ws.readyState = WebSocket.CLOSING }),
  }
  return ws
}

function createMockState(initialKv: Record<string, unknown> = {}) {
  const sockets = new Map<object, string[]>()
  const kv = new Map<string, unknown>(Object.entries(initialKv))
  return {
    setWebSocketAutoResponse: vi.fn(),
    acceptWebSocket: vi.fn((ws: object, tags: string[]) => {
      sockets.set(ws, tags)
    }),
    // Mirrors workerd: the untagged list iterates newest-first, tagged lists
    // iterate in accept order.
    getWebSockets: vi.fn((tag?: string) => {
      if (!tag) return [...sockets.keys()].reverse()
      return [...sockets.entries()].filter(([, t]) => t.includes(tag)).map(([ws]) => ws)
    }),
    getTags: vi.fn((ws: object) => sockets.get(ws) ?? []),
    getWebSocketAutoResponseTimestamp: vi.fn((_ws: object): Date | null => null),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
    storage: {
      setAlarm: vi.fn(),
      deleteAlarm: vi.fn(),
      get: vi.fn((key: string) => Promise.resolve(kv.get(key))),
      put: vi.fn((key: string, value: unknown) => {
        kv.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        kv.delete(key)
        return Promise.resolve()
      }),
    },
    _kv: kv,
  }
}

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

  it('trims buffer on ack', async () => {
    for (let i = 0; i < 5; i++) {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: `e${i}` }))
    }
    mobileWs.send.mockClear()
    await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'ack', seq: 3 }))
    await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'replay', fromSeq: 4 }))
    expect(mobileWs.send).toHaveBeenCalledTimes(2)
    const calls = mobileWs.send.mock.calls.map((c: string[]) => JSON.parse(c[0]))
    expect(calls[0].seq).toBe(4)
    expect(calls[1].seq).toBe(5)
  })

  it('sends reset when replay fromSeq covers events lost to MAX_BUFFER_SIZE overflow', async () => {
    const MAX = 500
    for (let i = 0; i < MAX + 5; i++) {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: `e${i}` }))
    }
    mobileWs.send.mockClear()
    await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'replay', fromSeq: 1 }))
    expect(mobileWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'reset' }))
  })

  it('does NOT send reset when buffer was emptied via clean ACKs (mobile already saw those events)', async () => {
    await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'x' }))
    await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'ack', seq: 1 }))
    mobileWs.send.mockClear()
    await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'replay', fromSeq: 1 }))
    expect(mobileWs.send).not.toHaveBeenCalledWith(JSON.stringify({ type: 'reset' }))
  })

  it('broadcasts desktop_shutdown to all mobiles and resets buffer/seq state', async () => {
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
    expect(state._kv.get('seq')).toBe(0)
    expect(state._kv.get('forcedDropSeq')).toBe(0)

    mobileWs.send.mockClear()
    await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'after' }))
    expect(mobileWs.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'event', seq: 1, data: 'after' }))
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
      expect(state._kv.get('seq')).toBe(1)
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

  describe('hibernation persistence', () => {
    it('seq counter survives hibernation by hydrating from storage so mobile dedup logic stays correct', async () => {
      const hibernatedState = createMockState({ seq: 27 })
      const desk = createMockWebSocket()
      const mob = createMockWebSocket()
      hibernatedState.acceptWebSocket(desk, ['desktop'])
      hibernatedState.acceptWebSocket(mob, ['mobile:dev-1'])
      const revived = new RelaySession(hibernatedState as any, {} as any)
      await (revived as unknown as { ready: Promise<void> }).ready

      await revived.webSocketMessage(desk as any, JSON.stringify({ type: 'event', data: 'after-hibernate' }))

      expect(mob.send).toHaveBeenCalledWith(JSON.stringify({ type: 'event', seq: 28, data: 'after-hibernate' }))
    })

    it('enqueue persists seq to storage so the next-DO-instance can resume the monotonic counter', async () => {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'first' }))
      expect(state.storage.put).toHaveBeenCalledWith('seq', 1)
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'second' }))
      expect(state.storage.put).toHaveBeenCalledWith('seq', 2)
    })

    it('forcedDropSeq survives hibernation so a post-hibernate replay correctly emits reset for events lost before the buffer flushed', async () => {
      const hibernatedState = createMockState({ seq: 600, forcedDropSeq: 100 })
      const desk = createMockWebSocket()
      const mob = createMockWebSocket()
      hibernatedState.acceptWebSocket(desk, ['desktop'])
      hibernatedState.acceptWebSocket(mob, ['mobile:dev-1'])
      const revived = new RelaySession(hibernatedState as any, {} as any)
      await (revived as unknown as { ready: Promise<void> }).ready

      await revived.webSocketMessage(mob as any, JSON.stringify({ type: 'replay', fromSeq: 50 }))

      expect(mob.send).toHaveBeenCalledWith(JSON.stringify({ type: 'reset' }))
    })

    it('alarm reset clears the persisted seq so the next session genuinely starts from zero', async () => {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'x' }))
      expect(state.storage.put).toHaveBeenCalledWith('seq', 1)
      await session.alarm()
      expect(state.storage.put).toHaveBeenCalledWith('seq', 0)
      expect(state.storage.put).toHaveBeenCalledWith('forcedDropSeq', 0)
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

    it('replay only resends events whose targets include the requesting mobile', async () => {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'a-only', targets: ['dev-1'] }))
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'b-only', targets: ['dev-2'] }))
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'broadcast' }))
      mobileWs.send.mockClear()
      mobileB.send.mockClear()

      await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'replay', fromSeq: 1 }))
      const aCalls = mobileWs.send.mock.calls.map((c: string[]) => JSON.parse(c[0]))
      expect(aCalls.map((c: { seq: number }) => c.seq)).toEqual([1, 3])

      await session.webSocketMessage(mobileB as any, JSON.stringify({ type: 'replay', fromSeq: 1 }))
      const bCalls = mobileB.send.mock.calls.map((c: string[]) => JSON.parse(c[0]))
      expect(bCalls.map((c: { seq: number }) => c.seq)).toEqual([2, 3])
    })
  })

  describe('per-device ACK + target-aware GC', () => {
    let mobileB: ReturnType<typeof createMockWebSocket>

    beforeEach(() => {
      mobileB = createMockWebSocket()
      state.acceptWebSocket(mobileB, ['mobile:dev-2'])
    })

    it('ACK from dev-1 does not delete an event targeted only at dev-2', async () => {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'a-only', targets: ['dev-1'] }))
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'b-only', targets: ['dev-2'] }))
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'broadcast' }))

      await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'ack', seq: 3 }))

      mobileB.send.mockClear()
      await session.webSocketMessage(mobileB as any, JSON.stringify({ type: 'replay', fromSeq: 1 }))
      const calls = mobileB.send.mock.calls.map((c: string[]) => JSON.parse(c[0]))
      const seqs = calls.filter((c: { type: string }) => c.type === 'event').map((c: { seq: number }) => c.seq)
      expect(seqs).toContain(2)
      expect(seqs).toContain(3)
    })

    it('targeted entry is GCed once its sole target ACKs past it', async () => {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'a-only', targets: ['dev-1'] }))
      expect((session as unknown as { buffer: unknown[] }).buffer).toHaveLength(1)
      await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'ack', seq: 1 }))
      expect((session as unknown as { buffer: unknown[] }).buffer).toHaveLength(0)
    })

    it('broadcast entry is NOT GCed until every online mobile ACKs', async () => {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'broadcast' }))
      await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'ack', seq: 1 }))

      mobileB.send.mockClear()
      await session.webSocketMessage(mobileB as any, JSON.stringify({ type: 'replay', fromSeq: 1 }))
      const calls = mobileB.send.mock.calls.map((c: string[]) => JSON.parse(c[0]))
      const events = calls.filter((c: { type: string }) => c.type === 'event')
      expect(events).toHaveLength(1)
      expect(events[0].seq).toBe(1)
    })

    it('broadcast entry is not GCed when the only un-ACKed mobile disconnects', async () => {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'broadcast' }))
      expect((session as unknown as { buffer: unknown[] }).buffer).toHaveLength(1)
      await session.webSocketClose(mobileB as any)
      await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'ack', seq: 1 }))
      expect((session as unknown as { buffer: unknown[] }).buffer).toHaveLength(1)
    })

    it('replays an unacked event after the target mobile reconnects', async () => {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'broadcast' }))
      await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'ack', seq: 1 }))
      expect((session as unknown as { buffer: unknown[] }).buffer).toHaveLength(1)
      await session.webSocketClose(mobileB as any)
      expect((session as unknown as { buffer: unknown[] }).buffer).toHaveLength(1)

      const reconnected = createMockWebSocket()
      state.acceptWebSocket(reconnected, ['mobile:dev-2'])
      await session.webSocketMessage(reconnected as any, JSON.stringify({ type: 'replay', fromSeq: 1 }))
      expect(reconnected.send).toHaveBeenCalledWith(JSON.stringify({ type: 'event', seq: 1, data: 'broadcast' }))

      await session.webSocketMessage(reconnected as any, JSON.stringify({ type: 'ack', seq: 1 }))
      expect((session as unknown as { buffer: unknown[] }).buffer).toHaveLength(0)
    })

    it('targets entry is enqueued even when target mobile is offline (replay on reconnect)', async () => {
      const offlineDevice = createMockWebSocket()
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'pending', targets: ['dev-3'] }))

      state.acceptWebSocket(offlineDevice, ['mobile:dev-3'])
      await session.webSocketMessage(offlineDevice as any, JSON.stringify({ type: 'replay', fromSeq: 1 }))
      expect(offlineDevice.send).toHaveBeenCalledWith(JSON.stringify({ type: 'event', seq: 1, data: 'pending' }))
    })

    it('forcedDropSeq advances when buffer overflows with pending ACKs', async () => {
      const MAX = 500
      for (let i = 0; i < MAX + 3; i++) {
        await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: `e${i}`, targets: ['dev-1'] }))
      }
      const internalSeq = (session as unknown as { forcedDropSeq: number }).forcedDropSeq
      expect(internalSeq).toBe(3)
    })

    it('stale ACK is a no-op (cur tracking)', async () => {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'a', targets: ['dev-1'] }))
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'b', targets: ['dev-1'] }))
      await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'ack', seq: 2 }))
      expect((session as unknown as { buffer: unknown[] }).buffer).toHaveLength(0)
      await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'ack', seq: 1 }))
      expect((session as unknown as { buffer: unknown[] }).buffer).toHaveLength(0)
    })

    it('response with mobileDeviceId routes to that mobile only', async () => {
      const frame = { type: 'response', requestId: 'r1', data: 'enc', mobileDeviceId: 'dev-2' }
      mobileWs.send.mockClear()
      mobileB.send.mockClear()
      await session.webSocketMessage(desktopWs as any, JSON.stringify(frame))
      expect(mobileB.send).toHaveBeenCalledWith(JSON.stringify(frame))
      expect(mobileWs.send).not.toHaveBeenCalled()
    })

    it('response without mobileDeviceId still broadcasts (back-compat)', async () => {
      const frame = { type: 'response', requestId: 'r1', data: 'enc' }
      mobileWs.send.mockClear()
      mobileB.send.mockClear()
      await session.webSocketMessage(desktopWs as any, JSON.stringify(frame))
      expect(mobileWs.send).toHaveBeenCalledWith(JSON.stringify(frame))
      expect(mobileB.send).toHaveBeenCalledWith(JSON.stringify(frame))
    })

    it('GC stops at the first non-droppable head entry (FIFO)', async () => {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'a-only', targets: ['dev-1'] }))
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'b-only', targets: ['dev-2'] }))
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'broadcast' }))
      await session.webSocketMessage(mobileWs as any, JSON.stringify({ type: 'ack', seq: 3 }))

      mobileB.send.mockClear()
      await session.webSocketMessage(mobileB as any, JSON.stringify({ type: 'replay', fromSeq: 1 }))
      const calls = mobileB.send.mock.calls.map((c: string[]) => JSON.parse(c[0]))
      const events = calls.filter((c: { type: string }) => c.type === 'event')
      expect(events.map((c: { seq: number }) => c.seq)).toEqual([2, 3])
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

  it('a flood of terminal frames does not advance seq, persist seq, or trigger forcedDrop, while interleaved events still ack/replay correctly', async () => {
    for (let i = 0; i < 600; i++) {
      await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'terminal', data: `t${i}` }))
    }
    expect(state._kv.get('seq')).toBeUndefined()
    expect(state.storage.put).not.toHaveBeenCalledWith('seq', expect.anything())
    expect(state._kv.get('forcedDropSeq')).toBeUndefined()

    await session.webSocketMessage(desktopWs as any, JSON.stringify({ type: 'event', data: 'real' }))
    expect(mobileA.send).toHaveBeenCalledWith(JSON.stringify({ type: 'event', seq: 1, data: 'real' }))

    mobileA.send.mockClear()
    await session.webSocketMessage(mobileA as any, JSON.stringify({ type: 'replay', fromSeq: 1 }))
    const calls = mobileA.send.mock.calls.map((c: string[]) => JSON.parse(c[0]))
    expect(calls).toEqual([{ type: 'event', seq: 1, data: 'real' }])
  })
})
