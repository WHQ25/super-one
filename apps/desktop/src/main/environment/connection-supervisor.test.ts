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
      stableAfterMs: 0,
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
      stableAfterMs: 0,
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

  it('keeps failure attempt across a short successful connection until stable window', async () => {
    let calls = 0
    const supervisor = new ConnectionSupervisor({
      environmentId: 'env-1',
      connectionId: 'c-1',
      baseDelayMs: 10,
      maxDelayMs: 20,
      random: () => 0,
      stableAfterMs: 200,
      connect: async () => {
        calls += 1
        if (calls === 1) throw new Error('down')
      },
    })
    await supervisor.start()
    expect(supervisor.getSnapshot().state).toBe('backoff')
    expect(supervisor.getSnapshot().attempt).toBe(1)

    await new Promise((r) => setTimeout(r, 40))
    expect(supervisor.getSnapshot().state).toBe('connected')
    // Still elevated until stableAfterMs elapses.
    expect(supervisor.getSnapshot().attempt).toBe(1)

    supervisor.notifyDisconnected('flap')
    expect(supervisor.getSnapshot().state).toBe('backoff')
    // Flap escalates rather than resetting to attempt 1.
    expect(supervisor.getSnapshot().attempt).toBe(2)
    supervisor.dispose()
  })

  it('resets attempt after continuous connected stable window', async () => {
    let calls = 0
    const okSupervisor = new ConnectionSupervisor({
      environmentId: 'env-1',
      connectionId: 'c-2',
      baseDelayMs: 10,
      maxDelayMs: 20,
      random: () => 0,
      stableAfterMs: 80,
      connect: async () => {
        calls += 1
        if (calls === 1) throw new Error('once')
      },
    })
    await okSupervisor.start()
    await new Promise((r) => setTimeout(r, 40))
    expect(okSupervisor.getSnapshot().state).toBe('connected')
    // Still within stableAfterMs window.
    expect(okSupervisor.getSnapshot().attempt).toBe(1)
    await new Promise((r) => setTimeout(r, 60))
    expect(okSupervisor.getSnapshot().attempt).toBe(0)
    okSupervisor.dispose()
  })

  it('wake on connected healthy probe retains the connection', async () => {
    let connectCalls = 0
    let probeCalls = 0
    const supervisor = new ConnectionSupervisor({
      environmentId: 'env-1',
      connectionId: 'c-1',
      stableAfterMs: 0,
      connect: async () => {
        connectCalls += 1
      },
      healthProbe: async () => {
        probeCalls += 1
        return true
      },
    })
    await supervisor.start()
    expect(connectCalls).toBe(1)
    await supervisor.wake('app-resume')
    expect(probeCalls).toBe(1)
    expect(connectCalls).toBe(1)
    expect(supervisor.getSnapshot().state).toBe('connected')
    supervisor.dispose()
  })

  it('wake on connected failed probe invalidates and re-dials immediately', async () => {
    let connectCalls = 0
    const invalidate = vi.fn()
    const supervisor = new ConnectionSupervisor({
      environmentId: 'env-1',
      connectionId: 'c-1',
      baseDelayMs: 10_000,
      maxDelayMs: 10_000,
      random: () => 0,
      stableAfterMs: 0,
      connect: async () => {
        connectCalls += 1
      },
      healthProbe: async () => false,
      invalidateTransport: invalidate,
    })
    await supervisor.start()
    expect(connectCalls).toBe(1)
    await supervisor.wake('app-resume')
    expect(invalidate).toHaveBeenCalled()
    expect(connectCalls).toBe(2)
    expect(supervisor.getSnapshot().state).toBe('connected')
    supervisor.dispose()
  })

  it('coalesces concurrent identical wake calls into one probe', async () => {
    let probeCalls = 0
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const supervisor = new ConnectionSupervisor({
      environmentId: 'env-1',
      connectionId: 'c-1',
      stableAfterMs: 0,
      connect: async () => {},
      healthProbe: async () => {
        probeCalls += 1
        await gate
        return true
      },
    })
    await supervisor.start()
    const a = supervisor.wake('app-resume')
    const b = supervisor.wake('app-resume')
    release()
    await Promise.all([a, b])
    // Same reason while in-flight collapses to a single drain iteration after the first
    // (pending is overwritten with the same reason and cleared once).
    expect(probeCalls).toBeLessThanOrEqual(2)
    expect(probeCalls).toBeGreaterThanOrEqual(1)
    supervisor.dispose()
  })

  it('wake does not unblock auth blocked state', async () => {
    const supervisor = new ConnectionSupervisor({
      environmentId: 'env-1',
      connectionId: 'c-1',
      connect: async () => {
        throw Object.assign(new Error('revoked'), { code: 'unauthorized' })
      },
    })
    await supervisor.start()
    expect(supervisor.getSnapshot().state).toBe('blocked')
    await supervisor.wake('app-resume')
    expect(supervisor.getSnapshot().state).toBe('blocked')
    expect(await supervisor.retryNow()).toBe('blocked')
    supervisor.dispose()
  })

  it('network-offline suspends retry and network-online dials again', async () => {
    let calls = 0
    const supervisor = new ConnectionSupervisor({
      environmentId: 'env-1',
      connectionId: 'c-1',
      baseDelayMs: 10_000,
      maxDelayMs: 10_000,
      random: () => 0,
      stableAfterMs: 0,
      connect: async () => {
        calls += 1
      },
    })
    await supervisor.start()
    expect(calls).toBe(1)
    await supervisor.wake('network-offline')
    expect(supervisor.getSnapshot().state).toBe('offline')
    await supervisor.wake('network-online')
    expect(supervisor.getSnapshot().state).toBe('connected')
    expect(calls).toBe(2)
    supervisor.dispose()
  })

  it('drains pending wake reasons so offline then online is not dropped', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    let calls = 0
    const supervisor = new ConnectionSupervisor({
      environmentId: 'env-1',
      connectionId: 'c-1',
      stableAfterMs: 0,
      connect: async () => {
        calls += 1
        if (calls === 1) await gate
      },
      healthProbe: async () => true,
    })
    const startP = supervisor.start()
    // While first dial is in flight, enqueue offline then online.
    const offlineP = supervisor.wake('network-offline')
    const onlineP = supervisor.wake('network-online')
    release()
    await startP
    await offlineP
    await onlineP
    // Final state should not be stuck offline after online was pending.
    expect(supervisor.getSnapshot().state).not.toBe('offline')
    supervisor.dispose()
  })

  it('offline bumps generation so a late connect success is discarded', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const supervisor = new ConnectionSupervisor({
      environmentId: 'env-1',
      connectionId: 'c-1',
      stableAfterMs: 0,
      connect: async () => {
        await gate
      },
    })
    const startP = supervisor.start()
    await Promise.resolve()
    await Promise.resolve()
    expect(supervisor.getSnapshot().state).toBe('synchronizing')
    const genBefore = supervisor.getSnapshot().generation
    await supervisor.wake('network-offline')
    expect(supervisor.getSnapshot().state).toBe('offline')
    expect(supervisor.getSnapshot().generation).toBeGreaterThan(genBefore)
    release()
    await startP
    // Late connect completion must not leave us connected.
    expect(supervisor.getSnapshot().state).toBe('offline')
    supervisor.dispose()
  })

  it('retryNow resets attempt and starts a dial from backoff', async () => {
    let calls = 0
    const supervisor = new ConnectionSupervisor({
      environmentId: 'env-1',
      connectionId: 'c-1',
      baseDelayMs: 10_000,
      maxDelayMs: 10_000,
      random: () => 0,
      stableAfterMs: 0,
      connect: async () => {
        calls += 1
        if (calls === 1) throw new Error('down')
      },
    })
    await supervisor.start()
    expect(supervisor.getSnapshot().state).toBe('backoff')
    expect(supervisor.getSnapshot().attempt).toBe(1)
    const disposition = await supervisor.retryNow()
    expect(disposition).toBe('started')
    expect(supervisor.getSnapshot().state).toBe('connected')
    expect(calls).toBe(2)
    supervisor.dispose()
  })

  /**
   * Without a periodic probe the only liveness checks are OS resume and
   * network-online edges, so a socket that dies while the machine stays awake
   * and online is never noticed.
   */
  describe('periodic health probing', () => {
    it('probes on an interval while connected and stays connected when healthy', async () => {
      let probes = 0
      const supervisor = new ConnectionSupervisor({
        environmentId: 'env-1',
        connectionId: 'c-1',
        stableAfterMs: 0,
        healthProbeIntervalMs: 20,
        connect: async () => {},
        healthProbe: async () => {
          probes += 1
          return true
        },
      })
      await supervisor.start()
      expect(supervisor.getSnapshot().state).toBe('connected')

      await new Promise((r) => setTimeout(r, 70))
      expect(probes).toBeGreaterThanOrEqual(2)
      expect(supervisor.getSnapshot().state).toBe('connected')
      supervisor.dispose()
    })

    it('invalidates the transport and re-dials when a periodic probe fails', async () => {
      let healthy = true
      let connects = 0
      const invalidated: string[] = []
      const supervisor = new ConnectionSupervisor({
        environmentId: 'env-1',
        connectionId: 'c-1',
        stableAfterMs: 0,
        healthProbeIntervalMs: 20,
        baseDelayMs: 5,
        random: () => 0,
        connect: async () => {
          connects += 1
        },
        healthProbe: async () => healthy,
        invalidateTransport: (reason) => {
          invalidated.push(reason)
        },
      })
      await supervisor.start()
      expect(connects).toBe(1)

      healthy = false
      await new Promise((r) => setTimeout(r, 70))

      expect(invalidated.length).toBeGreaterThanOrEqual(1)
      expect(connects).toBeGreaterThanOrEqual(2)
      expect(supervisor.getSnapshot().state).toBe('connected')
      supervisor.dispose()
    })

    it('stops probing once disposed', async () => {
      let probes = 0
      const supervisor = new ConnectionSupervisor({
        environmentId: 'env-1',
        connectionId: 'c-1',
        stableAfterMs: 0,
        healthProbeIntervalMs: 20,
        connect: async () => {},
        healthProbe: async () => {
          probes += 1
          return true
        },
      })
      await supervisor.start()
      await new Promise((r) => setTimeout(r, 30))
      supervisor.dispose()
      const after = probes
      await new Promise((r) => setTimeout(r, 60))
      expect(probes).toBe(after)
    })
  })
})
