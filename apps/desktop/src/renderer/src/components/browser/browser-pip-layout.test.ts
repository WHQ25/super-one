import { describe, expect, it } from 'vitest'
import { clampBrowserPipLayout, createDefaultBrowserPipLayout } from './browser-pip-layout'

const BOUNDS = { left: 100, top: 50, width: 1000, height: 700 }

describe('browser picture-in-picture layout', () => {
  it('starts in the top-right corner of the chat bounds', () => {
    expect(createDefaultBrowserPipLayout(BOUNDS)).toEqual({
      left: 728,
      top: 62,
      width: 360,
      height: 240,
    })
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
})
