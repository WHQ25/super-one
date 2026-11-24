import { describe, expect, it } from 'vitest'
import {
  buildHeaderRecessClipPath,
  buildSiblingClipPath,
  findInsertIndexInStrip,
  resolveContentPosition,
  resolveFallbackSplitPosition,
  stepTabOrder,
} from './chrome-tab-drag-geometry'
import { buildTabStripFadeMask } from './sticky-active-tab'

describe('chrome-tab-drag-geometry', () => {
  it('builds recess clip-path with top corners and bottom concave fillets', () => {
    const path = buildHeaderRecessClipPath(600, 36, 100, 220, 14, 14)
    expect(path).toContain('A 14 14 0 0 0 100 14')
    expect(path).toContain('A 14 14 0 0 1 86 36')
    expect(path).toContain('A 14 14 0 0 1 220 22')
    expect(path).toContain('A 14 14 0 0 0 206 0')
  })

  it('clips both sides of a wide sibling when overlapped in the middle', () => {
    expect(buildSiblingClipPath(200, 36, 50, 120)).toBe(
      "path('M 0 0 L 50 0 L 50 36 L 0 36 Z M 120 0 L 200 0 L 200 36 L 120 36 Z')",
    )
    expect(buildSiblingClipPath(100, 36, 0, 100)).toBe('inset(0 100% 0 0)')
    expect(buildSiblingClipPath(100, 36, 100, 200)).toBe('')
  })

  it('steps sticky tabs directly to visual slot without oscillating for wide active tabs', () => {
    const widths = [180, 100, 100, 100, 100]
    const order = [0, 1, 2, 3, 4]
    expect(stepTabOrder(order, 0, -250, widths, 10)).toBe(true)
    expect(order.indexOf(0)).toBeGreaterThan(0)
    const snapshot = [...order]
    expect(stepTabOrder(order, 0, -250, widths, 10)).toBe(false)
    expect(order).toEqual(snapshot)
  })

  it('resolves 35/30/35 split zones and insertion index', () => {
    const rect = { left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    expect(resolveContentPosition(rect, 69, 100)).toBe('left')
    expect(resolveContentPosition(rect, 131, 100)).toBe('right')
    expect(resolveContentPosition(rect, 100, 69)).toBe('top')
    expect(resolveContentPosition(rect, 100, 131)).toBe('bottom')
    expect(resolveContentPosition(rect, 100, 100)).toBe('center')
    expect(findInsertIndexInStrip([{ left: 0, right: 100 }, { left: 100, right: 200 }], 40)).toBe(0)
    expect(findInsertIndexInStrip([{ left: 0, right: 100 }, { left: 100, right: 200 }], 140)).toBe(1)
    expect(findInsertIndexInStrip([{ left: 0, right: 100 }, { left: 100, right: 200 }], 220)).toBe(2)
    expect(resolveFallbackSplitPosition({ left: 0, right: 200, top: 0, bottom: 400 }, { left: 200, right: 500, top: 0, bottom: 400 })).toBe('left')
  })

  it('places fade gradients beside sticky active tab without fading the active tab itself', () => {
    const leftSticky = buildTabStripFadeMask({
      viewportWidth: 300,
      scrollLeft: 300,
      scrollWidth: 800,
      activeLeft: 0,
      activeRight: 120,
      flowLeft: 200,
      activeWidth: 120,
    })
    expect(leftSticky).toBe(
      'linear-gradient(to right, #000 0px, #000 120px, transparent 120px, #000 144px, #000 276px, transparent 300px)',
    )

    const rightSticky = buildTabStripFadeMask({
      viewportWidth: 300,
      scrollLeft: 100,
      scrollWidth: 800,
      activeLeft: 180,
      activeRight: 300,
      flowLeft: 500,
      activeWidth: 120,
    })
    expect(rightSticky).toBe(
      'linear-gradient(to right, transparent 0px, #000 24px, #000 156px, transparent 180px, #000 180px, #000 300px)',
    )
  })
})
