import { describe, expect, it, beforeEach } from 'vitest'
import {
  clearSessionSettlePending,
  isSessionSettlePending,
  withSessionSettlePending,
} from './session-settle-pending'

const FOLDER = 'remote:node:/srv/app'

beforeEach(() => {
  clearSessionSettlePending()
})

describe('withSessionSettlePending', () => {
  it('marks the session until the work finishes', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const flight = withSessionSettlePending(FOLDER, 's1', () => gate)
    expect(isSessionSettlePending(FOLDER, 's1')).toBe(true)
    expect(isSessionSettlePending(FOLDER, 'other')).toBe(false)
    release()
    await flight
    expect(isSessionSettlePending(FOLDER, 's1')).toBe(false)
  })

  it('ignores a second call until the first finishes', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let runs = 0
    const first = withSessionSettlePending(FOLDER, 's1', async () => {
      runs += 1
      await gate
    })
    const second = await withSessionSettlePending(FOLDER, 's1', async () => {
      runs += 1
    })
    expect(second).toBeUndefined()
    expect(runs).toBe(1)
    expect(isSessionSettlePending(FOLDER, 's1')).toBe(true)
    release()
    await first
    expect(isSessionSettlePending(FOLDER, 's1')).toBe(false)
  })

  it('clears the mark when the work fails', async () => {
    await expect(withSessionSettlePending(FOLDER, 's1', async () => {
      throw new Error('offline')
    })).rejects.toThrow('offline')
    expect(isSessionSettlePending(FOLDER, 's1')).toBe(false)
  })
})
