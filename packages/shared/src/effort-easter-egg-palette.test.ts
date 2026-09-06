import { describe, expect, it } from 'vitest'
import { FIRE_SWEEP_CENTERS, fireSweepOpacity, lerpColor, DARK_COLORS, RAINBOW_DARK, RAINBOW_LIGHT } from './effort-easter-egg-palette'

describe('fireSweepOpacity', () => {
  it('is full at the start of the loop and dark through the middle', () => {
    expect(fireSweepOpacity(0)).toBe(1)
    expect(fireSweepOpacity(0.25)).toBe(0)
    expect(fireSweepOpacity(0.5)).toBe(0)
    expect(fireSweepOpacity(0.75)).toBe(0)
  })

  it('closes the loop: one full turn lands back on the same value', () => {
    expect(fireSweepOpacity(1)).toBe(fireSweepOpacity(0))
    expect(fireSweepOpacity(1.4)).toBe(fireSweepOpacity(0.4))
    expect(fireSweepOpacity(-0.1)).toBeCloseTo(fireSweepOpacity(0.9))
  })

  it('keeps exactly one centre lit at a time', () => {
    for (const phase of [0, 0.1, 0.3, 0.6, 0.85]) {
      const lit = FIRE_SWEEP_CENTERS
        .map((_, index) => fireSweepOpacity(phase + index / FIRE_SWEEP_CENTERS.length))
        .filter((value) => value > 0)
      expect(lit.length).toBeLessThanOrEqual(2)
      expect(lit.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1)
    }
  })
})

describe('palettes', () => {
  it('walks the ember ramp from young to spent', () => {
    expect(lerpColor(DARK_COLORS, 0)).toEqual(DARK_COLORS[0])
    expect(lerpColor(DARK_COLORS, 1)).toEqual(DARK_COLORS[DARK_COLORS.length - 1])
  })

  it('closes both rainbows so the scroll has no seam', () => {
    expect(RAINBOW_DARK[0]).toBe(RAINBOW_DARK[RAINBOW_DARK.length - 1])
    expect(RAINBOW_LIGHT[0]).toBe(RAINBOW_LIGHT[RAINBOW_LIGHT.length - 1])
  })
})
