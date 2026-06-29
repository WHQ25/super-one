import { describe, it, expect } from 'vitest'
import { LAYOUT, maxSidebarWidth } from './layout-constants'
import { makeLeaf, measureMin, MIN_TILE_W, DIVIDER_SIZE, type MosaicBranch } from '@/components/mosaic/mosaic-tree'

const twoColumns: MosaicBranch = {
  type: 'branch',
  direction: 'row',
  ratio: 0.5,
  first: makeLeaf('A', '/p', 'A'),
  second: makeLeaf('B', '/p', 'B'),
}

describe('maxSidebarWidth in mosaic mode', () => {
  it('reserves the mosaic split minimum so a two-column layout is never clipped', () => {
    const innerWidth = 1200
    const mosaicMinW = measureMin(twoColumns).w // 360 + 360 + 1 = 721
    expect(mosaicMinW).toBe(2 * MIN_TILE_W + DIVIDER_SIZE)

    const mainMin = Math.max(LAYOUT.MIN_MAIN, mosaicMinW)
    const maxSw = maxSidebarWidth(innerWidth, mainMin, 0)

    // The sidebar must be capped low enough that the remaining main area still
    // fits the mosaic minimum — i.e. tiles keep their 360px floor.
    expect(innerWidth - maxSw - LAYOUT.CARD_GUTTER).toBeGreaterThanOrEqual(mosaicMinW)
    // Regression: the old MIN_MAIN-only formula would have allowed the hard cap.
    const buggyMax = maxSidebarWidth(innerWidth, LAYOUT.MIN_MAIN, 0)
    expect(buggyMax).toBe(LAYOUT.MAX_SIDEBAR)
    expect(maxSw).toBeLessThan(buggyMax)
  })

  it('falls back to MIN_MAIN for a single tile (no extra reservation)', () => {
    const mainMin = Math.max(LAYOUT.MIN_MAIN, measureMin(makeLeaf('A', '/p', 'A')).w)
    expect(mainMin).toBe(LAYOUT.MIN_MAIN)
    expect(maxSidebarWidth(1200, mainMin, 0)).toBe(LAYOUT.MAX_SIDEBAR)
  })

  it('also subtracts the activity panel reservation', () => {
    const mosaicMinW = measureMin(twoColumns).w
    const mainMin = Math.max(LAYOUT.MIN_MAIN, mosaicMinW)
    const withAp = maxSidebarWidth(1200, mainMin, LAYOUT.MIN_AP)
    expect(withAp).toBe(1200 - LAYOUT.MIN_AP - mainMin - LAYOUT.CARD_GUTTER)
    expect(1200 - withAp - LAYOUT.MIN_AP - LAYOUT.CARD_GUTTER).toBeGreaterThanOrEqual(mosaicMinW)
  })
})
