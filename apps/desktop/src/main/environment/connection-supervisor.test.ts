import { describe, expect, it, vi } from 'vitest'
import { ConnectionSupervisor } from './connection-supervisor'

describe('ConnectionSupervisor', () => {
  it('transitions available -> connecting -> synchronizing -> connected', async () => {
    const states: string[] = []
    const supervisor = new ConnectionSupervisor({
      environmentId: 'env-1',
      connectionId: 'c-1',
      connect: async () => {},
      onStateChange: (s) => states.push(s.state),
    })
    await supervisor.start()
    expect(supervisor.getSnapshot().state).toBe('connected')
    expect(states).toEqual(['connecting', 'synchronizing', 'connected'])
  })

  it('backs off on transient failure then reconnects', async () => {
    let calls = 0
    const supervisor = new ConnectionSupervisor({
      environmentId: 'env-1',
      connectionId: 'c-1',
      baseDelayMs: 10,
      maxDelayMs: 20,
      random: () => 0,
      connect: async () => {
        calls += 1
        if (calls === 1) throw new Error('network down')
      },
    })
    await supervisor.start()
    expect(supervisor.getSnapshot().state).toBe('backoff')

    await new Promise((r) => setTimeout(r, 40))
    expect(supervisor.getSnapshot().state).toBe('connected')
    expect(calls).toBe(2)
    supervisor.dispose()
  })

  it('blocks on auth failures without retry', async () => {
    const supervisor = new ConnectionSupervisor({
      environmentId: 'env-1',
      connectionId: 'c-1',
      connect: async () => {
        throw Object.assign(new Error('revoked'), { code: 'unauthorized' })
      },
    })
    await supervisor.start()
    expect(supervisor.getSnapshot().state).toBe('blocked')
    expect(supervisor.getSnapshot().blockReason).toBe('auth')
  })

  it('blocks on identity conflict', async () => {
    const supervisor = new ConnectionSupervisor({
      environmentId: 'env-1',
      connectionId: 'c-1',
      connect: async () => {
        throw Object.assign(new Error('clone'), { code: 'identity_conflict' })
      },
    })
    await supervisor.start()
    expect(supervisor.getSnapshot().state).toBe('blocked')
    expect(supervisor.getSnapshot().blockReason).toBe('identity_conflict')
  })
})
