import { describe, expect, it } from 'vitest'
import { parseCursorUsage } from './cursor'

describe('parseCursorUsage', () => {
  it('reads the total and both model pools, resetting at the end of the billing cycle', () => {
    const limits = parseCursorUsage({ billingCycleEnd: '1791760869000', planUsage: { totalPercentUsed: 6.5, autoPercentUsed: 4, apiPercentUsed: 82 } }, 'ultra')
    expect(limits).toEqual({
      planType: 'Ultra',
      extraUsage: null,
      windows: [
        { label: 'Total', usedPercent: 6.5, resetsAt: 1_791_760_869 },
        { label: 'Cursor models', usedPercent: 4, resetsAt: 1_791_760_869 },
        { label: 'Other models', usedPercent: 82, resetsAt: 1_791_760_869 },
      ],
    })
  })

  it('derives the total from spend when Cursor sends no percentage', () => {
    expect(parseCursorUsage({ planUsage: { limit: 2000, remaining: 1500 } }, null)?.windows).toEqual([{ label: 'Total', usedPercent: 25, resetsAt: null }])
  })

  it('rejects a body without plan usage', () => {
    expect(parseCursorUsage({ enabled: false }, null)).toBeNull()
  })
})
