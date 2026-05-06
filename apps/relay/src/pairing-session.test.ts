import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PairingSession } from './pairing-session'

function createMockWebSocket() {
  return {
    send: vi.fn(),
    close: vi.fn(),
  }
}

function createMockState() {
  const sockets = new Map<object, string[]>()
  return {
    setWebSocketAutoResponse: vi.fn(),
    acceptWebSocket: vi.fn((ws: object, tags: string[]) => {
      sockets.set(ws, tags)
    }),
    getWebSockets: vi.fn((tag?: string) => {
      if (!tag) return [...sockets.keys()]
      return [...sockets.entries()].filter(([, t]) => t.includes(tag)).map(([ws]) => ws)
    }),
    getTags: vi.fn((ws: object) => sockets.get(ws) ?? []),
    storage: {
      setAlarm: vi.fn(),
      deleteAlarm: vi.fn(),
    },
  }
}

describe('PairingSession', () => {
  let state: ReturnType<typeof createMockState>
  let session: PairingSession
  let desktopWs: ReturnType<typeof createMockWebSocket>
  let mobileWs: ReturnType<typeof createMockWebSocket>

  beforeEach(() => {
    state = createMockState()
    session = new PairingSession(state as any, {} as any)
    desktopWs = createMockWebSocket()
    mobileWs = createMockWebSocket()
    state.acceptWebSocket(desktopWs, ['desktop'])
    state.acceptWebSocket(mobileWs, ['mobile'])
  })

  it('forwards pair_request from mobile to desktop', async () => {
    const msg = JSON.stringify({ type: 'pair_request', data: 'encrypted' })
    await session.webSocketMessage(mobileWs as any, msg)
    expect(desktopWs.send).toHaveBeenCalledWith(msg)
  })

  it('forwards pair_response from desktop to mobile', async () => {
    const msg = JSON.stringify({ type: 'pair_response', data: 'encrypted' })
    await session.webSocketMessage(desktopWs as any, msg)
    expect(mobileWs.send).toHaveBeenCalledWith(msg)
  })

  it('forwards pair_rejected from desktop to mobile', async () => {
    const msg = JSON.stringify({ type: 'pair_rejected' })
    await session.webSocketMessage(desktopWs as any, msg)
    expect(mobileWs.send).toHaveBeenCalledWith(msg)
  })

  it('silently drops messages when peer is not connected', async () => {
    const lonelyState = createMockState()
    const lonelySession = new PairingSession(lonelyState as any, {} as any)
    const ws = createMockWebSocket()
    lonelyState.acceptWebSocket(ws, ['mobile'])
    await lonelySession.webSocketMessage(ws as any, JSON.stringify({ type: 'pair_request', data: 'x' }))
  })

  it('ignores invalid JSON', async () => {
    await session.webSocketMessage(mobileWs as any, 'not-json')
    expect(desktopWs.send).not.toHaveBeenCalled()
  })

  it('ignores non-string messages', async () => {
    await session.webSocketMessage(mobileWs as any, new ArrayBuffer(4))
    expect(desktopWs.send).not.toHaveBeenCalled()
  })
})
