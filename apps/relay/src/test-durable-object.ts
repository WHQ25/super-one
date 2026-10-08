import { vi } from 'vitest'

/** Test doubles for the Durable Object runtime pieces `RelaySession` touches. */

export function createMockWebSocket() {
  let attachment: unknown = null
  const ws = {
    readyState: WebSocket.OPEN as number,
    send: vi.fn((_data: string) => {}),
    // Persisted with the socket across hibernation, like the runtime's.
    serializeAttachment: vi.fn((value: unknown) => { attachment = structuredClone(value) }),
    deserializeAttachment: vi.fn(() => attachment),
    // Like the runtime: close() moves to CLOSING, and the socket stays listed
    // until the close handshake completes — which a half-open link never does.
    close: vi.fn((_code?: number, _reason?: string) => { ws.readyState = WebSocket.CLOSING }),
  }
  return ws
}

export function createMockState(initialKv: Record<string, unknown> = {}) {
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
