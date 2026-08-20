import { describe, expect, it } from 'vitest'
import { iosSimulatorScreenAspect, iosSimulatorScreenRadius } from './IosSimulatorBareScreen'

describe('bare screen geometry', () => {
  it('matches the iPhone 17 Pro Max screen Apple actually ships', () => {
    // Both numbers come off the device type on disk: `profile.plist` gives a
    // 1320 x 2868 screen, and the rasterised `framebufferMask` puts the corner
    // curve's extent at 212px. Pinned so a later tweak has to disagree on purpose.
    expect(iosSimulatorScreenAspect('iphone')).toBeCloseTo(1320 / 2868, 5)
    expect(iosSimulatorScreenRadius('iphone', 2868)).toBe(212)
  })

  it('scales the corner with the rendered screen instead of holding a fixed pixel radius', () => {
    // A screen drawn 400px tall and one drawn 800px tall are the same object at two
    // distances; a constant radius would make the small one look like a tablet.
    // Within a pixel, because the result is rounded to whole device pixels.
    const small = iosSimulatorScreenRadius('iphone', 400)
    const large = iosSimulatorScreenRadius('iphone', 800)

    expect(Math.abs(large - small * 2)).toBeLessThanOrEqual(1)
  })

  it('gives an iPhone a rounder corner than an iPad', () => {
    expect(iosSimulatorScreenRadius('iphone', 700)).toBeGreaterThan(iosSimulatorScreenRadius('ipad', 700))
  })

  it('stands a portrait phone taller than it is wide, and a TV the other way round', () => {
    expect(iosSimulatorScreenAspect('iphone')).toBeLessThan(1)
    expect(iosSimulatorScreenAspect('tv')).toBeGreaterThan(1)
  })
})
