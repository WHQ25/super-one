import { describe, expect, it } from 'vitest'
import {
  BROWSER_FALLBACK_VIEWPORT,
  browserPipAspect,
  clampBrowserPipLayout,
  createDefaultBrowserPipLayout,
  resolveBrowserPipViewport,
} from './browser-pip-layout'

const BOUNDS = { left: 100, top: 50, width: 1000, height: 700 }

describe('browser picture-in-picture layout', () => {
  it('starts in the top-right corner of the chat bounds', () => {
    expect(createDefaultBrowserPipLayout(BOUNDS)).toEqual({
      left: 888,
      top: 62,
      width: 200,
      height: 112.5,
    })
  })

  it('sizes the default frame to the tab viewport aspect ratio', () => {
    const wide = createDefaultBrowserPipLayout(BOUNDS, 16 / 9)
    expect(wide).toEqual({
      left: 888,
      top: 62,
      width: 200,
      height: 112.5,
    })

    const tall = createDefaultBrowserPipLayout(BOUNDS, 560 / 800)
    expect(tall.height).toBeCloseTo(200 / (560 / 800))
    expect(tall.width).toBe(200)
    expect(tall.top).toBe(62)
    expect(tall.width / tall.height).toBeCloseTo(560 / 800)
  })

  it('keeps a portrait default at the requested 200px width', () => {
    const mobile = createDefaultBrowserPipLayout(BOUNDS, 375 / 812)
    expect(mobile.width).toBe(200)
    expect(mobile.height).toBeCloseTo(200 / (375 / 812))
    expect(mobile.width / mobile.height).toBeCloseTo(375 / 812)
  })

  it('caps width at 80% and keeps the frame inside chat bounds', () => {
    expect(clampBrowserPipLayout(
      { left: -100, top: 900, width: 950, height: 900 },
      BOUNDS,
    )).toEqual({
      left: 112,
      top: 62,
      width: 800,
      height: 676,
    })
  })

  it('keeps the tab aspect ratio when clamping to the chat bounds', () => {
    const layout = clampBrowserPipLayout(
      { left: -100, top: 900, width: 950, height: 200 },
      BOUNDS,
      16 / 9,
    )
    expect(layout.width).toBe(800)
    expect(layout.height).toBeCloseTo(450)
    expect(layout.left).toBe(112)
    expect(layout.top).toBe(288)
    expect(layout.width / layout.height).toBeCloseTo(16 / 9)
  })

  it('shrinks below the normal minimum when the chat area is narrow', () => {
    const narrow = { left: 0, top: 0, width: 300, height: 260 }
    const layout = clampBrowserPipLayout(
      { left: 0, top: 0, width: 480, height: 320 },
      narrow,
    )
    expect(layout.width).toBe(240)
    expect(layout.height).toBe(236)
    expect(layout.left).toBe(12)
    expect(layout.top).toBe(12)
  })

  it('allows user resizing down to 200px wide', () => {
    const layout = clampBrowserPipLayout(
      { left: 500, top: 100, width: 80, height: 50 },
      BOUNDS,
      16 / 9,
    )

    expect(layout.width).toBe(200)
    expect(layout.height).toBe(112.5)
  })

  it('prefers emulation, then the panel slot, then the capture fallback', () => {
    expect(resolveBrowserPipViewport({ width: 390, height: 844 }, { width: 560, height: 800 }))
      .toEqual({ width: 390, height: 844 })
    expect(resolveBrowserPipViewport(null, { width: 560, height: 800 }))
      .toEqual({ width: 560, height: 800 })
    expect(resolveBrowserPipViewport(null, null)).toEqual(BROWSER_FALLBACK_VIEWPORT)
    expect(browserPipAspect(BROWSER_FALLBACK_VIEWPORT)).toBeCloseTo(1280 / 800)
  })
})
