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

  it('notifyDisconnected from connected schedules one backoff reconnect', async () => {
    let calls = 0
    const supervisor = new ConnectionSupervisor({
      environmentId: 'env-1',
      connectionId: 'c-1',
      baseDelayMs: 10,
      maxDelayMs: 20,
      random: () => 0,
      connect: async () => {
        calls += 1
      },
    })
    await supervisor.start()
    expect(supervisor.getSnapshot().state).toBe('connected')
    expect(calls).toBe(1)

    supervisor.notifyDisconnected('websocket closed')
    expect(supervisor.getSnapshot().state).toBe('backoff')
    expect(supervisor.getSnapshot().attempt).toBe(1)

    // Duplicate notify while backoff must not schedule another dial.
    supervisor.notifyDisconnected('websocket closed again')
    expect(supervisor.getSnapshot().attempt).toBe(1)

    await new Promise((r) => setTimeout(r, 40))
    expect(supervisor.getSnapshot().state).toBe('connected')
    expect(calls).toBe(2)
    supervisor.dispose()
  })

  it('ignores notifyDisconnected during synchronizing', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const supervisor = new ConnectionSupervisor({
      environmentId: 'env-1',
      connectionId: 'c-1',
      connect: async () => {
        await gate
      },
    })
    const startPromise = supervisor.start()
    // Yield so runConnect reaches synchronizing.
    await Promise.resolve()
    await Promise.resolve()
    expect(supervisor.getSnapshot().state).toBe('synchronizing')
    supervisor.notifyDisconnected('stale close')
    expect(supervisor.getSnapshot().state).toBe('synchronizing')
    release()
    await startPromise
    expect(supervisor.getSnapshot().state).toBe('connected')
    supervisor.dispose()
  })

  it('dispose prevents a pending backoff retry', async () => {
    let calls = 0
    const supervisor = new ConnectionSupervisor({
      environmentId: 'env-1',
      connectionId: 'c-1',
      baseDelayMs: 50,
      maxDelayMs: 50,
      random: () => 0,
      connect: async () => {
        calls += 1
        if (calls === 1) throw new Error('down')
      },
    })
    await supervisor.start()
    expect(supervisor.getSnapshot().state).toBe('backoff')
    supervisor.dispose()
    await new Promise((r) => setTimeout(r, 80))
    expect(calls).toBe(1)
  })
})
