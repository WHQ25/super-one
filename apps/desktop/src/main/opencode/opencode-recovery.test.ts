import { describe, expect, it, vi } from 'vitest'
import { OpenCodeRecovery } from './opencode-recovery'
import type { OpenCodeV2Event } from './opencode-v2-types'

function channel(signal: AbortSignal) {
  const values: OpenCodeV2Event[] = []
  let waiter: (() => void) | undefined
  let failure: unknown
  signal.addEventListener('abort', () => waiter?.(), { once: true })
  return {
    push: (event: OpenCodeV2Event) => { values.push(event); waiter?.() },
    fail: () => { failure = new Error('lost connection'); waiter?.() },
    stream: (async function* () {
      for (;;) {
        if (failure) throw failure
        if (signal.aborted) return
        if (values.length) yield values.shift()!
        else await new Promise<void>((resolve) => { waiter = resolve })
      }
    })(),
  }
}
const event = (seq: number, type = 'session.execution.succeeded', data = {}): OpenCodeV2Event => ({
  id: `event-${seq}`, type, data: { sessionID: 'native', ...data }, durable: { aggregateID: 'native', seq, version: 1 },
} as OpenCodeV2Event)

describe('OpenCode event recovery', () => {
  it('seeds the log head, replays missed facts and drops the warmed live overlap', async () => {
    const abort = new AbortController(), initial = channel(abort.signal), resumed = channel(abort.signal)
    const received: Array<{ event: OpenCodeV2Event; replay?: boolean }> = []
    const reconcile = vi.fn(async () => undefined), states = vi.fn()
    const missed = event(12), next = event(13)
    const client = { eventStream: vi.fn(async () => resumed.stream), sessionLog: vi.fn()
      .mockResolvedValueOnce({ events: [], cursor: 10 }).mockResolvedValueOnce({ events: [missed], cursor: 12 }) }
    const recovery = new OpenCodeRecovery(client, 'native', abort.signal, (event, replay) => received.push({ event, replay }), reconcile, states, 1)
    await recovery.initialize()
    const run = recovery.run(initial.stream)
    initial.push(event(11))
    await vi.waitFor(() => expect(received).toHaveLength(1))
    initial.fail()
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledOnce())
    resumed.push(missed); resumed.push(next)
    await vi.waitFor(() => expect(received).toHaveLength(3))
    expect(received.map(({ event }) => event.durable!.seq)).toEqual([11, 12, 13])
    expect(received[1].replay).toBe(true)
    expect(client.sessionLog).toHaveBeenLastCalledWith('native', 11, abort.signal)
    expect(states).toHaveBeenLastCalledWith('connected', 1)
    abort.abort(); await run
  })

  it('suppresses overlapping live fragments for replayed steps while new steps still stream', async () => {
    const abort = new AbortController(), initial = channel(abort.signal), resumed = channel(abort.signal)
    const received = vi.fn()
    const client = { eventStream: vi.fn(async () => resumed.stream), sessionLog: vi.fn()
      .mockResolvedValueOnce({ events: [], cursor: 1 }).mockResolvedValueOnce({ events: [event(2, 'session.text.ended', { assistantMessageID: 'old', ordinal: 0, text: 'complete' })], cursor: 2 }) }
    const recovery = new OpenCodeRecovery(client, 'native', abort.signal, received, async () => {}, () => {}, 1)
    await recovery.initialize()
    const run = recovery.run(initial.stream)
    initial.fail()
    await vi.waitFor(() => expect(received).toHaveBeenCalledOnce())
    resumed.push({ id: 'old-fragment', type: 'session.text.delta', data: { sessionID: 'native', assistantMessageID: 'old', ordinal: 0, delta: 'complete' } })
    resumed.push({ id: 'new-fragment', type: 'session.text.delta', data: { sessionID: 'native', assistantMessageID: 'new', ordinal: 0, delta: 'new' } })
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(2))
    expect(received.mock.calls[1][0].id).toBe('new-fragment')
    abort.abort(); await run
  })

  it('bounds retries and reports failure without retrying business operations', async () => {
    const abort = new AbortController(), initial = channel(abort.signal)
    const client = { eventStream: vi.fn(async () => { throw new Error('unavailable') }), sessionLog: vi.fn(async () => ({ events: [], cursor: 0 })) }
    const recovery = new OpenCodeRecovery(client, 'native', abort.signal, vi.fn(), vi.fn(), vi.fn(), 1)
    await recovery.initialize()
    const run = recovery.run(initial.stream)
    const failed = expect(run).rejects.toThrow('input was not resent')
    initial.fail(); await failed
    expect(client.eventStream).toHaveBeenCalledTimes(5)
  })

  it('aborts retry delays on runtime close and never reports a false reconnection', async () => {
    const abort = new AbortController(), initial = channel(abort.signal)
    const client = { eventStream: vi.fn(), sessionLog: vi.fn(async () => ({ events: [], cursor: 0 })) }, states = vi.fn()
    const recovery = new OpenCodeRecovery(client, 'native', abort.signal, vi.fn(), vi.fn(), states, 1000)
    await recovery.initialize()
    const run = recovery.run(initial.stream).catch(() => {})
    states.mockClear()
    initial.fail()
    await vi.waitFor(() => expect(states).toHaveBeenCalledWith('recovering', 1))
    abort.abort(); await run
    expect(client.eventStream).not.toHaveBeenCalled()
    expect(states).not.toHaveBeenCalledWith('connected', expect.anything())
  })

  it('restores a projection for a partial log before accepting its terminal watermark', async () => {
    const abort = new AbortController(), initial = channel(abort.signal), resumed = channel(abort.signal)
    const received = vi.fn(), reconcile = vi.fn(async () => ['restored'])
    const client = { eventStream: vi.fn(async () => resumed.stream), sessionLog: vi.fn()
      .mockResolvedValueOnce({ events: [], cursor: 10 }).mockResolvedValueOnce({ events: [event(12)], cursor: 12 }) }
    const recovery = new OpenCodeRecovery(client, 'native', abort.signal, received, reconcile, vi.fn(), 1)
    await recovery.initialize(); const run = recovery.run(initial.stream)
    initial.fail()
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledWith(true))
    resumed.push(event(12)); resumed.push(event(13))
    await vi.waitFor(() => expect(received).toHaveBeenCalledOnce())
    expect(received.mock.calls[0][0].durable.seq).toBe(13)
    abort.abort(); await run
  })

  it('allows one manual retry after exhaustion and keeps callers behind the same observation barrier', async () => {
    const abort = new AbortController(), initial = channel(abort.signal), resumed = channel(abort.signal)
    const states = vi.fn(), received = vi.fn()
    const client = { eventStream: vi.fn(async () => { throw new Error('offline') }), sessionLog: vi.fn(async () => ({ events: [], cursor: 0 })) }
    const recovery = new OpenCodeRecovery(client, 'native', abort.signal, received, vi.fn(), states, 1)
    await recovery.initialize(); const run = recovery.run(initial.stream)
    const failed = expect(run).rejects.toThrow('input was not resent'); initial.fail(); await failed
    await expect(recovery.ready()).rejects.toThrow('input was not resent')
    client.eventStream.mockImplementation(async () => resumed.stream)
    const first = recovery.retry(), second = recovery.retry(), ready = recovery.ready()
    await Promise.all([first, second, ready])
    expect(client.eventStream).toHaveBeenCalledTimes(6)
    resumed.push(event(1)); await vi.waitFor(() => expect(received).toHaveBeenCalledOnce())
    expect(states).toHaveBeenLastCalledWith('connected', 1)
    abort.abort(); await recovery.join()
  })
})
