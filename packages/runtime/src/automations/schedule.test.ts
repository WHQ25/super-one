import { describe, expect, it, vi } from 'vitest'
import type { AutomationSchedule } from '@superone/shared/agent-types'

vi.mock('croner', () => ({
  Cron: class {
    constructor(private expr: string) {
      void this.expr
    }
    nextRun() {
      return new Date('2026-05-01T09:00:00.000Z')
    }
  },
}))

import { computeNextRunAt } from './schedule'

describe('computeNextRunAt (runtime shared)', () => {
  it('returns runAt for one-time schedule', () => {
    const schedule: AutomationSchedule = { type: 'one-time', runAt: '2026-05-01T09:00:00.000Z' }
    expect(computeNextRunAt(schedule)).toBe('2026-05-01T09:00:00.000Z')
  })

  it('returns undefined for one-time without runAt', () => {
    const schedule: AutomationSchedule = { type: 'one-time' }
    expect(computeNextRunAt(schedule)).toBeUndefined()
  })

  it('uses croner for recurring schedule', () => {
    const schedule: AutomationSchedule = { type: 'recurring', cron: '0 9 * * *' }
    expect(computeNextRunAt(schedule)).toBe('2026-05-01T09:00:00.000Z')
  })

  it('returns undefined for recurring without cron', () => {
    const schedule: AutomationSchedule = { type: 'recurring' }
    expect(computeNextRunAt(schedule)).toBeUndefined()
  })
})
