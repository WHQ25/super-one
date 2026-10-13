import { describe, expect, it } from 'vitest'
import { isModelOnlyHostWake } from './host-wake'

describe('isModelOnlyHostWake', () => {
  it('hides every host wake by default', () => {
    expect(isModelOnlyHostWake({ source: 'task-notification' })).toBe(true)
  })

  it('keeps a user-authored wake visible', () => {
    expect(isModelOnlyHostWake({ source: 'task-notification', userAuthored: true })).toBe(false)
  })

  it.each([undefined, 'user', 'collaboration'] as const)('never hides other sources: %s', (source) => {
    expect(isModelOnlyHostWake({ source })).toBe(false)
  })
})
