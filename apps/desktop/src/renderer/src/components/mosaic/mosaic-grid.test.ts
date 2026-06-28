import { describe, it, expect } from 'vitest'
import { computeCapacity, reflowToCapacity, type GridTile } from './mosaic-grid'

function grid3x3(): GridTile[] {
  const tiles: GridTile[] = []
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const id = row === 1 && col === 1 ? 'F' : `r${row}c${col}`
      tiles.push({ id, projectPath: '/p', sessionId: id, row, col })
    }
  }
  return tiles
}

const ids = (tiles: GridTile[]) => tiles.map((t) => t.id).sort()

describe('computeCapacity', () => {
  it('floors width/height by min slot, never below 1', () => {
    expect(computeCapacity(1200, 1000, 380, 480)).toEqual({ cols: 3, rows: 2 })
    expect(computeCapacity(100, 100, 380, 480)).toEqual({ cols: 1, rows: 1 })
  })
})

describe('reflowToCapacity — directional eviction', () => {
  it('peels the rightmost column when shrinking from the right (3→2 cols)', () => {
    const { kept, evicted } = reflowToCapacity(grid3x3(), 3, 3, 2, 3, 'F', 'right', 'bottom')
    expect(ids(evicted)).toEqual(['r0c2', 'r1c2', 'r2c2'])
    const focus = kept.find((t) => t.id === 'F')!
    expect(focus).toMatchObject({ row: 1, col: 1 })
    expect(kept).toHaveLength(6)
  })

  it('swaps the focused tile into the surviving column before peeling its column (3→1 cols, focus centered)', () => {
    const { kept, evicted } = reflowToCapacity(grid3x3(), 3, 3, 1, 3, 'F', 'right', 'bottom')
    const focus = kept.find((t) => t.id === 'F')!
    expect(focus.col).toBe(0)
    expect(kept.every((t) => t.col === 0)).toBe(true)
    expect(kept).toHaveLength(3)
    // the original left-middle tile was sacrificed in the focus's place
    expect(kept.find((t) => t.id === 'r1c0')).toBeUndefined()
    expect(evicted.map((t) => t.id)).toContain('r1c0')
    expect(kept.find((t) => t.id === 'F')).toBeDefined()
  })

  it('peels the bottom row when shrinking vertically, swapping focus up to survive', () => {
    // focus at bottom-middle, shrink to 1 row from the bottom
    const tiles = grid3x3().map((t) =>
      t.id === 'F' ? { ...t, row: 2, col: 1 } : t.row === 2 && t.col === 1 ? { ...t, id: 'F', row: 2, col: 1 } : t,
    )
    const focusTiles: GridTile[] = []
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      const id = row === 2 && col === 1 ? 'F' : `r${row}c${col}`
      focusTiles.push({ id, projectPath: '/p', sessionId: id, row, col })
    }
    const { kept } = reflowToCapacity(focusTiles, 3, 3, 3, 1, 'F', 'right', 'bottom')
    const focus = kept.find((t) => t.id === 'F')!
    expect(focus.row).toBe(0)
    expect(kept.every((t) => t.row === 0)).toBe(true)
    expect(kept).toHaveLength(3)
    void tiles
  })

  it('peels from the left edge and reindexes remaining columns', () => {
    const { kept, evicted } = reflowToCapacity(grid3x3(), 3, 3, 2, 3, 'F', 'left', 'bottom')
    expect(ids(evicted)).toEqual(['r0c0', 'r1c0', 'r2c0'])
    // remaining columns reindexed to 0..1
    expect(Math.max(...kept.map((t) => t.col))).toBe(1)
    expect(kept.find((t) => t.id === 'F')).toMatchObject({ col: 0 })
  })
})
