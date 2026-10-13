import { describe, expect, it, vi } from 'vitest'
import { operateNodeQueue } from './queued-controls'
import type { NodeSessionRecord, TurnRunner } from './types'
import type { TurnOpts } from './accepted-turn'

function fixture(submitted: boolean) {
  const session = { sessionId: 'session', harnessId: 'opencode', status: 'streaming' } as NodeSessionRecord
  const queue: TurnOpts[] = ['first', 'steered', 'last'].map(id => ({ text: id, clientMessageId: id, parkInComposer: true }))
  let reject!: (error: Error) => void
  const delivery = new Promise<void>((_, fail) => { reject = fail })
  const runner: TurnRunner = Object.assign(async () => ({ finalText: '' }), {
    steer: vi.fn<NonNullable<TurnRunner['steer']>>(async (_session, _input, callbacks) => { if (submitted) callbacks.onInputAccepted(); await delivery }),
  })
  const deps = { session, queue, runner, admitting: new Set<string>(), assertControl: () => {},
    consumed: vi.fn(), dequeued: vi.fn(), abandoned: vi.fn() }
  const operation = operateNodeQueue('session.steer', { clientMessageId: 'steered', priority: 'now' }, deps)
  void operation.catch(() => {})
  return { deps, operation, reject }
}

describe('node queued steering races', () => {
  it('restores a rejected promotion at its original queue position while the turn is viable', async () => {
    const { deps, operation, reject } = fixture(false)
    expect(deps.queue.map(turn => turn.clientMessageId)).toEqual(['first', 'last'])
    reject(new Error('native refusal'))
    await expect(operation).rejects.toThrow('native refusal')
    expect(deps.queue.map(turn => turn.clientMessageId)).toEqual(['first', 'steered', 'last'])
    expect(deps.consumed).not.toHaveBeenCalled()
    expect(deps.admitting.size).toBe(0)
  })
  it.each([false, true])('never restores input after Stop when native admission is %s', async submitted => {
    const { deps, operation, reject } = fixture(submitted)
    deps.session.status = 'interrupted'
    reject(new Error('stopped during admission'))
    await expect(operation).rejects.toThrow('stopped during admission')
    expect(deps.queue.map(turn => turn.clientMessageId)).toEqual(['first', 'last'])
    expect(deps.consumed).toHaveBeenCalledTimes(submitted ? 1 : 0)
    expect(deps.abandoned).toHaveBeenCalledTimes(submitted ? 0 : 1)
    expect(deps.admitting.size).toBe(0)
  })
})
