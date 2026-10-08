import { describe, expect, it } from 'vitest'
import { readLiveStatus } from './live-status'

describe('readLiveStatus', () => {
  it('counts running and pending sessions', () => {
    const status = readLiveStatus({
      sessions: [{ running: true, pending: false }, { running: true, pending: true }, { running: false, pending: false }],
      gui: 'locked',
    })
    expect(status.sessions).toEqual({ running: 2, pending: 1 })
    expect(status.gui).toBe('locked')
    expect(status.cpuCores).toBeGreaterThan(0)
    expect(status.freeMemoryBytes).toBeGreaterThan(0)
  })

  it('omits session counts on a host that serves no sessions', () => {
    expect(readLiveStatus({ sessions: null, gui: 'unavailable' })).not.toHaveProperty('sessions')
  })
})
