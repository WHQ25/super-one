import { describe, expect, it, vi } from 'vitest'
import type { CodexSession } from './codex-session'
import type { AppServerNotification } from './app-server-connection'

const mocks = vi.hoisted(() => ({ request: vi.fn(), stream: vi.fn(), interrupt: vi.fn() }))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('./codex-thread-selection', () => ({ syncCodexThreadSelection: vi.fn(async () => {}) }))
vi.mock('./codex-turn', () => ({
  withThreadConnection: (...args: unknown[]) => (args.at(-1) as (input: unknown) => unknown)({ connection: { request: mocks.request }, threadId: 'thread' }),
  streamTurnEvents: mocks.stream, deriveFinalResponse: () => '', mapThreadItemFromAppServer: vi.fn(), rejectPendingApprovals: vi.fn(),
}))
import { startCodexRealtime } from './codex-realtime'

function setup() {
  let notify!: (notification: AppServerNotification) => void
  const dispatcher = { registerRealtimeInbox: () => ({ next: () => new Promise<AppServerNotification>(resolve => { notify = resolve }) }),
    registerRealtimeTurnInbox: vi.fn(() => ({})), unregisterRealtimeInbox: vi.fn(), unregisterRealtimeTurnInbox: vi.fn() }
  const session = { permissionPreset: 'default', notificationDispatcher: dispatcher } as unknown as CodexSession
  let finishTurn!: () => void
  mocks.request.mockReset().mockResolvedValue({})
  mocks.stream.mockReset().mockImplementation(async (_connection, _session, _id, controller, callbacks) => {
    callbacks.onTurnStarted({ turnId: 'turn' })
    await new Promise<void>(resolve => { finishTurn = resolve; controller.signal.addEventListener('abort', resolve, { once: true }) })
    callbacks.onTurnCompleted({ turnId: 'turn' })
    return { threadId: 'thread', turnId: 'turn', items: [], usage: null, turnUsage: null }
  })
  const completed = vi.fn()
  const start = () => startCodexRealtime(session, {} as never, '/repo', '/repo', { sdp: 'v=0\na=offer' }, vi.fn(), { callbacks: {}, onCompleted: completed, onError: vi.fn() })
  return { session, start, notify: (n: AppServerNotification) => notify(n), finishTurn: () => finishTurn(), completed }
}
describe('Codex voice teardown barrier', () => {
  it('waits for voice closure while a delegated task continues with its approval controller', async () => {
    const f = setup(); const handle = await f.start()
    let stopped = false
    const stopping = handle.stop().then(() => { stopped = true })
    await Promise.resolve(); expect(stopped).toBe(false)
    f.notify({ method: 'thread/realtime/closed', params: {} })
    await stopping
    expect(f.session.runningController?.signal.aborted).toBe(false)
    expect(f.completed).not.toHaveBeenCalled()
    expect(mocks.request.mock.calls.map(([method]) => method)).toEqual(['thread/realtime/start', 'thread/realtime/stop'])
    f.finishTurn(); await handle.delegatedTurns
    expect(f.completed).toHaveBeenCalledTimes(1)
  })
  it('cleans a failed start through stop and closure before rejecting, preserving its delegated task', async () => {
    const f = setup()
    mocks.request.mockImplementation(async method => {
      if (method === 'thread/realtime/start') throw new Error('start failed')
      f.notify({ method: 'thread/realtime/closed', params: {} }); return {}
    })
    await expect(f.start()).rejects.toThrow('start failed')
    expect(f.session.runningController?.signal.aborted).toBe(false)
    f.finishTurn(); await new Promise(resolve => setTimeout(resolve, 0))
    expect(f.completed).toHaveBeenCalledTimes(1)
  })
})
