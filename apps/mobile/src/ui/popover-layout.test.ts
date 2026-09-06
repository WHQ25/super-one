import { describe, expect, it } from 'vitest'
import { popoverLayout } from './popover-layout'

describe('menu placement', () => {
  it('opens above a phone composer within the keyboard viewport', () => {
    const layout = popoverLayout({ x: 300, y: 390, width: 90, height: 44 }, { width: 400, height: 450, top: 44, bottom: 0 }, 300, 280)
    expect(layout.top + layout.height).toBeLessThan(390)
    expect(layout.left + layout.width).toBeLessThanOrEqual(392)
    expect(layout.height).toBe(280)
  })
  it('opens below a header and keeps long content scrollable', () => {
    const layout = popoverLayout({ x: 12, y: 44, width: 44, height: 44 }, { width: 390, height: 844, top: 44, bottom: 34 }, 300, 1200)
    expect(layout.top).toBe(96)
    expect(layout.top + layout.height).toBeLessThanOrEqual(802)
  })
  it('fits a narrow split view even when the anchor is obscured', () => {
    const layout = popoverLayout({ x: 350, y: 250, width: 40, height: 44 }, { width: 240, height: 180, top: 44, bottom: 20 }, 300, 400)
    expect(layout.width).toBe(224)
    expect(layout.left).toBe(8)
    expect(layout.top).toBeGreaterThanOrEqual(52)
    expect(layout.top + layout.height).toBeLessThanOrEqual(152)
  })
})
