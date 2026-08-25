import { describe, it, expect } from 'vitest'
import { MIN_CHAT_WIDTH } from '@superone/shared/agent-types'
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
  it('allows the chat area to shrink to 360px', () => {
    expect(MIN_CHAT_WIDTH).toBe(360)
    expect(LAYOUT.MIN_MAIN).toBe(MIN_CHAT_WIDTH)
    expect(LAYOUT.MIN_SIDEBAR).toBe(320)
  })

  it('reserves the mosaic split minimum so a two-column layout is never clipped', () => {
    const innerWidth = 1100
    const mosaicMinW = measureMin(twoColumns).w
    expect(mosaicMinW).toBe(2 * MIN_TILE_W + DIVIDER_SIZE)

    const mainMin = Math.max(LAYOUT.MIN_MAIN, mosaicMinW)
    const maxSw = maxSidebarWidth(innerWidth, mainMin, 0)

    // The sidebar must be capped low enough that the remaining main area still
    // fits the mosaic minimum — i.e. tiles keep the shared chat-width floor.
    expect(innerWidth - maxSw - LAYOUT.CARD_GUTTER).toBeGreaterThanOrEqual(mosaicMinW)
    // Regression: the old MIN_MAIN-only formula would have allowed the hard cap.
    const buggyMax = maxSidebarWidth(innerWidth, LAYOUT.MIN_MAIN, 0)
    expect(buggyMax).toBe(LAYOUT.MAX_SIDEBAR)
    expect(maxSw).toBeLessThan(buggyMax)
  })

  it('uses the chat minimum for a single mosaic tile', () => {
    const mainMin = Math.max(LAYOUT.MIN_MAIN, measureMin(makeLeaf('A', '/p', 'A')).w)
    expect(MIN_TILE_W).toBe(MIN_CHAT_WIDTH)
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
