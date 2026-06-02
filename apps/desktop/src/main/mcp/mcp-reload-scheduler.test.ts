import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { scheduleMcpReload, cancelMcpReload, hasPendingMcpReload } from './mcp-reload-scheduler'

describe('mcp-reload-scheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('debounces a burst of changes into a single reload', () => {
    const run = vi.fn()
    scheduleMcpReload('s1', run, 300)
    scheduleMcpReload('s1', run, 300)
    scheduleMcpReload('s1', run, 300)
    vi.advanceTimersByTime(300)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('debounces each session independently', () => {
    const a = vi.fn()
    const b = vi.fn()
    scheduleMcpReload('a', a, 300)
    scheduleMcpReload('b', b, 300)
    vi.advanceTimersByTime(300)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('cancelMcpReload stops a pending reload from firing for a disposed session', () => {
    const run = vi.fn()
    scheduleMcpReload('s1', run, 300)
    expect(hasPendingMcpReload('s1')).toBe(true)

    cancelMcpReload('s1')
    expect(hasPendingMcpReload('s1')).toBe(false)

    vi.advanceTimersByTime(300)
    expect(run).not.toHaveBeenCalled()
  })

  it('clears its own map entry after firing', () => {
    scheduleMcpReload('s1', vi.fn(), 300)
    vi.advanceTimersByTime(300)
    expect(hasPendingMcpReload('s1')).toBe(false)
  })
})
