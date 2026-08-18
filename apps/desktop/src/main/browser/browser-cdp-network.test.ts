import { beforeEach, describe, expect, it, vi } from 'vitest'

type DebuggerListener = (...args: unknown[]) => void
const listeners = new Map<string, Set<DebuggerListener>>()
const acquireDomain = vi.fn(async () => {})
const releaseDomain = vi.fn(async () => {})

const fakeDebugger = {
  on: vi.fn((event: string, listener: DebuggerListener) => {
    const set = listeners.get(event) ?? new Set<DebuggerListener>()
    set.add(listener)
    listeners.set(event, set)
  }),
  off: vi.fn((event: string, listener: DebuggerListener) => listeners.get(event)?.delete(listener)),
}

const fakeWc = {
  id: 42,
  debugger: fakeDebugger,
  once: vi.fn(),
}

vi.mock('./browser-cdp', () => ({
  ensureAttachedById: vi.fn(() => fakeWc),
  cdpSend: vi.fn(async () => ({})),
  isCdpMockEnabled: vi.fn(() => true),
  acquireDomain,
  releaseDomain,
}))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

const { startRecording, stopRecording } = await import('./browser-cdp-network')

function emit(event: string, ...args: unknown[]): void {
  for (const listener of listeners.get(event) ?? []) listener(...args)
}

beforeEach(() => {
  acquireDomain.mockClear()
  releaseDomain.mockClear()
})

describe('network recording detach lifecycle', () => {
  it('does not let a detached old recording release a newly acquired Network domain', async () => {
    const oldRecording = await startRecording(42)
    emit('detach', {}, 'target_closed')

    const newRecording = await startRecording(42)
    expect(acquireDomain).toHaveBeenCalledTimes(2)

    await stopRecording(oldRecording)
    expect(releaseDomain).not.toHaveBeenCalled()

    await stopRecording(newRecording)
    expect(releaseDomain).toHaveBeenCalledTimes(1)
  })
})
