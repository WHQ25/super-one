import { describe, expect, it } from 'vitest'
import { STICKY_PALETTE } from './plan-sticky-palette'
import { markerBlendMode, markerStrokeStyle } from './plan-sticky-visuals'

describe('markerStrokeStyle', () => {
  const swatch = STICKY_PALETTE[0]!

  it('paints a dark stroke as flat ink, blended once by its group', () => {
    const grouped = markerStrokeStyle(swatch, true, 1, false)
    expect(grouped.backgroundColor).toBe(swatch.markerDark.base)
    expect(grouped.backgroundImage).toBeUndefined()
    expect(grouped.transform).toBeUndefined()
    expect(grouped.mixBlendMode).toBeUndefined()
    expect(markerStrokeStyle(swatch, true, 1).mixBlendMode).toBe('screen')
    expect(markerBlendMode(true)).toBe('screen')
  })

  it('keeps the light-mode pen: grain and darker ink at the ends', () => {
    const light = markerStrokeStyle(swatch, false, 1, false)
    expect(String(light.backgroundImage)).toContain(swatch.marker.deep)
    expect(markerBlendMode(false)).toBe('multiply')
  })
})
