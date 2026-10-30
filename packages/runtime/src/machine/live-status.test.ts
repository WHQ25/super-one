import { afterEach, describe, expect, it, vi } from 'vitest'
import { cpuPercentBetween, sampleCpuPercent } from './live-status'

const times = (user: number, idle: number) => ({ user, nice: 0, sys: 0, idle, irq: 0 })

describe('cpu sample', () => {
  afterEach(() => { vi.useRealTimers() })

  it('turns the idle gap into a busy percent', () => {
    expect(cpuPercentBetween({ idle: 0, total: 0 }, { idle: 75, total: 100 })).toBe(25)
    expect(cpuPercentBetween({ idle: 0, total: 0 }, { idle: 0, total: 40 })).toBe(100)
    expect(cpuPercentBetween({ idle: 10, total: 10 }, { idle: 10, total: 10 })).toBeNull()
    expect(cpuPercentBetween({ idle: 0, total: 0 }, { idle: 50, total: 40 })).toBe(0)
  })

  it('reads a second snapshot after the sample window', async () => {
    vi.useFakeTimers()
    const read = vi.fn()
      .mockReturnValueOnce([{ times: times(0, 0) }])
      .mockReturnValueOnce([{ times: times(25, 75) }])
    const pending = sampleCpuPercent(200, read)
    await vi.advanceTimersByTimeAsync(200)
    await expect(pending).resolves.toBe(25)
    expect(read).toHaveBeenCalledTimes(2)
  })
})
