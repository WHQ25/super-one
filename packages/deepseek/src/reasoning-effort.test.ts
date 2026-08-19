import { describe, expect, it } from 'vitest'
import { dshEffortFromSuperone, superoneEffortsFromDsh } from './reasoning-effort'

describe('superoneEffortsFromDsh', () => {
  it('keeps the adapter display order for the shared levels', () => {
    expect(superoneEffortsFromDsh(['off', 'low', 'high', 'max'])).toEqual(['low', 'high', 'max'])
  })

  it('drops `off`, which the shared vocabulary cannot express', () => {
    expect(superoneEffortsFromDsh(['off'])).toEqual([])
  })

  it('drops ids no adapter in this vocabulary owns', () => {
    expect(superoneEffortsFromDsh(['low', 'ludicrous'])).toEqual(['low'])
  })

  it('de-duplicates repeated ids', () => {
    expect(superoneEffortsFromDsh(['low', 'low', 'high'])).toEqual(['low', 'high'])
  })
})

describe('dshEffortFromSuperone', () => {
  it('round-trips the shared levels', () => {
    expect(dshEffortFromSuperone('low')).toBe('low')
    expect(dshEffortFromSuperone('high')).toBe('high')
    expect(dshEffortFromSuperone('max')).toBe('max')
  })

  it('refuses to alias levels DeepSeek does not implement', () => {
    // Aliasing `medium` onto `high` would run the turn at an effort the user
    // never picked; leaving it unset defers to the adapter's own default.
    expect(dshEffortFromSuperone('medium')).toBeUndefined()
    expect(dshEffortFromSuperone('xhigh')).toBeUndefined()
  })

  it('treats absent and null as "leave the route alone"', () => {
    expect(dshEffortFromSuperone(undefined)).toBeUndefined()
    expect(dshEffortFromSuperone(null)).toBeUndefined()
  })
})
