import { describe, it, expect } from 'vitest'
import {
  makeLeaf,
  insertBeside,
  addLeaf,
  removeLeaf,
  setRatioAtPath,
  collectLeaves,
  leafCount,
  findLeaf,
  topLeftLeafId,
  topRightLeafId,
  measureMin,
  clampRatioToMin,
  canSplit,
  planDrop,
  removeLeafRebalanced,
  MIN_TILE_W,
  MIN_TILE_H,
  DIVIDER_SIZE,
  type MosaicBranch,
  type MosaicNode,
} from './mosaic-tree'

const leaf = (id: string) => makeLeaf(id, '/p', id)

describe('insertBeside', () => {
  it('splits a leaf into a row with the new tile on the right', () => {
    const root = insertBeside(leaf('A'), 'A', 'right', leaf('B'))
    expect(root).toMatchObject({ type: 'branch', direction: 'row', ratio: 0.5 })
    const b = root as MosaicBranch
    expect(b.first).toMatchObject({ id: 'A' })
    expect(b.second).toMatchObject({ id: 'B' })
  })

  it('splits a leaf into a row with the new tile on the left', () => {
    const b = insertBeside(leaf('A'), 'A', 'left', leaf('B')) as MosaicBranch
    expect(b.direction).toBe('row')
    expect(b.first).toMatchObject({ id: 'B' })
    expect(b.second).toMatchObject({ id: 'A' })
  })

  it('splits a leaf into a column for top/bottom', () => {
    const top = insertBeside(leaf('A'), 'A', 'top', leaf('B')) as MosaicBranch
    expect(top.direction).toBe('column')
    expect(top.first).toMatchObject({ id: 'B' })
    expect(top.second).toMatchObject({ id: 'A' })
    const bottom = insertBeside(leaf('A'), 'A', 'bottom', leaf('B')) as MosaicBranch
    expect(bottom.direction).toBe('column')
    expect(bottom.first).toMatchObject({ id: 'A' })
    expect(bottom.second).toMatchObject({ id: 'B' })
  })

  it('splits a nested target without touching siblings', () => {
    const root: MosaicNode = {
      type: 'branch', direction: 'row', ratio: 0.5,
      first: leaf('A'),
      second: leaf('B'),
    }
    const next = insertBeside(root, 'B', 'bottom', leaf('C')) as MosaicBranch
    expect(next.first).toMatchObject({ id: 'A' })
    expect(next.second).toMatchObject({ type: 'branch', direction: 'column' })
    expect(leafCount(next)).toBe(3)
  })
})

describe('addLeaf — even redistribution on a full-height/full-width track', () => {
  it('makes even thirds when adding a 3rd column to a 2-column layout', () => {
    // { row, A, B } at any ratio; B is full-height → drop right of B adds a column
    const start: MosaicNode = { type: 'branch', direction: 'row', ratio: 0.5, first: leaf('A'), second: leaf('B') }
    const next = addLeaf(start, 'B', 'right', leaf('C')) as MosaicBranch
    // A = 1/3, { row, B, C } = 2/3 → inner 1/2 → A=B=C=1/3
    expect(next.ratio).toBeCloseTo(1 / 3, 5)
    expect((next.second as MosaicBranch).ratio).toBeCloseTo(1 / 2, 5)
  })

  it('rebalances even when prior columns were manually resized', () => {
    const start: MosaicNode = { type: 'branch', direction: 'row', ratio: 0.8, first: leaf('A'), second: leaf('B') }
    const next = addLeaf(start, 'A', 'left', leaf('C')) as MosaicBranch
    // columns become C | A | B all equal → outer first holds {C,A}=2/3, second B=1/3
    expect(next.ratio).toBeCloseTo(2 / 3, 5)
    expect((next.first as MosaicBranch).ratio).toBeCloseTo(1 / 2, 5)
  })

  it('keeps a plain 50/50 split when the target is not full along the dropped axis', () => {
    // A is NOT full-height (its parent column splits its height), so a left drop is a local bisect
    const start: MosaicNode = { type: 'branch', direction: 'column', ratio: 0.5, first: leaf('A'), second: leaf('B') }
    const next = addLeaf(start, 'A', 'left', leaf('C')) as MosaicBranch
    expect((next.first as MosaicBranch).ratio).toBe(0.5)
    expect(next.ratio).toBe(0.5)
  })

  it('does the first split as an even half', () => {
    const next = addLeaf(leaf('A'), 'A', 'right', leaf('B')) as MosaicBranch
    expect(next.ratio).toBe(0.5)
  })

  it('evens the rows inside a column when adding a 3rd row there (rows behave like columns)', () => {
    // A | (B over C): add D under C → right column becomes 3 even rows, left column untouched
    const start: MosaicNode = {
      type: 'branch', direction: 'row', ratio: 0.5,
      first: leaf('A'),
      second: { type: 'branch', direction: 'column', ratio: 0.5, first: leaf('B'), second: leaf('C') },
    }
    const next = addLeaf(start, 'C', 'bottom', leaf('D')) as MosaicBranch
    expect(next.ratio).toBe(0.5) // outer column split untouched
    const rightCol = next.second as MosaicBranch
    expect(rightCol.direction).toBe('column')
    expect(rightCol.ratio).toBeCloseTo(1 / 3, 5) // B = 1/3
    expect((rightCol.second as MosaicBranch).ratio).toBeCloseTo(1 / 2, 5) // C, D split remaining → 1/3 each
  })
})

describe('removeLeaf', () => {
  it('collapses the parent branch to the surviving sibling (lone session fills the column)', () => {
    // { row, A, { column, B, C } } — remove C → { row, A, B }, B fills the whole right column
    const root: MosaicNode = {
      type: 'branch', direction: 'row', ratio: 0.5,
      first: leaf('A'),
      second: { type: 'branch', direction: 'column', ratio: 0.5, first: leaf('B'), second: leaf('C') },
    }
    const next = removeLeaf(root, 'C') as MosaicBranch
    expect(next.direction).toBe('row')
    expect(next.first).toMatchObject({ id: 'A' })
    expect(next.second).toMatchObject({ type: 'leaf', id: 'B' })
  })

  it('returns the lone leaf when removing down to one', () => {
    const root = insertBeside(leaf('A'), 'A', 'right', leaf('B'))
    expect(removeLeaf(root, 'B')).toMatchObject({ type: 'leaf', id: 'A' })
  })

  it('returns null when removing the only leaf', () => {
    expect(removeLeaf(leaf('A'), 'A')).toBeNull()
  })

  it('is a no-op for an unknown id', () => {
    const root = insertBeside(leaf('A'), 'A', 'right', leaf('B'))
    expect(removeLeaf(root, 'Z')).toBe(root)
  })
})

describe('setRatioAtPath', () => {
  it('sets the ratio at the root branch and clamps', () => {
    const root = insertBeside(leaf('A'), 'A', 'right', leaf('B')) as MosaicBranch
    expect((setRatioAtPath(root, [], 0.3) as MosaicBranch).ratio).toBe(0.3)
    expect((setRatioAtPath(root, [], 0.001) as MosaicBranch).ratio).toBe(0.05)
    expect((setRatioAtPath(root, [], 0.999) as MosaicBranch).ratio).toBe(0.95)
  })

  it('sets the ratio at a nested branch by path', () => {
    const root: MosaicNode = {
      type: 'branch', direction: 'row', ratio: 0.5,
      first: leaf('A'),
      second: { type: 'branch', direction: 'column', ratio: 0.5, first: leaf('B'), second: leaf('C') },
    }
    const next = setRatioAtPath(root, ['second'], 0.7) as MosaicBranch
    expect((next.second as MosaicBranch).ratio).toBe(0.7)
    expect(next.ratio).toBe(0.5)
  })
})

describe('measureMin', () => {
  it('returns the tile minimum for a leaf', () => {
    expect(measureMin(leaf('A'))).toEqual({ w: MIN_TILE_W, h: MIN_TILE_H })
  })

  it('sums along the split axis and maxes across it', () => {
    const row: MosaicNode = { type: 'branch', direction: 'row', ratio: 0.5, first: leaf('A'), second: leaf('B') }
    expect(measureMin(row)).toEqual({ w: MIN_TILE_W * 2 + DIVIDER_SIZE, h: MIN_TILE_H })
    const nested: MosaicNode = {
      type: 'branch', direction: 'row', ratio: 0.5,
      first: leaf('A'),
      second: { type: 'branch', direction: 'column', ratio: 0.5, first: leaf('B'), second: leaf('C') },
    }
    expect(measureMin(nested)).toEqual({ w: MIN_TILE_W * 2 + DIVIDER_SIZE, h: MIN_TILE_H * 2 + DIVIDER_SIZE })
  })
})

describe('clampRatioToMin', () => {
  it('keeps both panes above their minimum', () => {
    const avail = 1000 - DIVIDER_SIZE
    expect(clampRatioToMin(0.1, 1000, 360, 360)).toBeCloseTo(360 / avail, 5)
    expect(clampRatioToMin(0.9, 1000, 360, 360)).toBeCloseTo(1 - 360 / avail, 5)
    expect(clampRatioToMin(0.5, 1000, 360, 360)).toBe(0.5)
  })

  it('falls back to the absolute ratio bounds when both mins cannot fit', () => {
    expect(clampRatioToMin(0.001, 500, 360, 360)).toBe(0.05)
    expect(clampRatioToMin(0.999, 500, 360, 360)).toBe(0.95)
  })
})

describe('canSplit', () => {
  it('allows a split only when the axis fits two minimum tiles plus the divider', () => {
    expect(canSplit({ width: 2 * MIN_TILE_W + DIVIDER_SIZE, height: 100 }, 'right')).toBe(true)
    expect(canSplit({ width: 2 * MIN_TILE_W + DIVIDER_SIZE - 1, height: 9999 }, 'left')).toBe(false)
    expect(canSplit({ width: 9999, height: 2 * MIN_TILE_H + DIVIDER_SIZE }, 'bottom')).toBe(true)
    expect(canSplit({ width: 9999, height: 2 * MIN_TILE_H + DIVIDER_SIZE - 1 }, 'top')).toBe(false)
  })

  it('judges each axis independently for a wide-but-short tile', () => {
    const wideShort = { width: 2000, height: MIN_TILE_H + 10 }
    expect(canSplit(wideShort, 'left')).toBe(true)
    expect(canSplit(wideShort, 'top')).toBe(false)
  })
})

describe('planDrop', () => {
  const twoCols: MosaicNode = { type: 'branch', direction: 'row', ratio: 0.5, first: leaf('A'), second: leaf('B') }
  // A | (B over C): a 2-column layout whose right column holds two stacked rows
  const colWithRows: MosaicNode = {
    type: 'branch', direction: 'row', ratio: 0.5,
    first: leaf('A'),
    second: { type: 'branch', direction: 'column', ratio: 0.5, first: leaf('B'), second: leaf('C') },
  }
  const bigContainer = { width: 4000, height: 3000 }

  it('returns a band sized to 1/(N+1) when adding a column to a full-height target', () => {
    const plan = planDrop(twoCols, 'B', 'right', bigContainer)
    expect(plan.mode).toBe('band')
    expect(plan.axis).toBe('x')
    expect(plan.count).toBe(3)
    expect(plan.index).toBe(2)
    expect(plan.regionPath).toEqual([])
    expect(plan.allowed).toBe(true)
  })

  it('places the band before the target on a left drop', () => {
    const plan = planDrop(twoCols, 'B', 'left', bigContainer)
    expect(plan.index).toBe(1)
    expect(plan.count).toBe(3)
  })

  it('bands a new row scoped to the inner column when adding inside a nested row group', () => {
    const plan = planDrop(colWithRows, 'C', 'bottom', bigContainer)
    expect(plan.mode).toBe('band')
    expect(plan.axis).toBe('y')
    expect(plan.count).toBe(3)
    expect(plan.index).toBe(2)
    expect(plan.regionPath).toEqual(['second'])
    expect(plan.allowed).toBe(true)
  })

  it('blocks the band when the region cannot fit N+1 minimum tiles', () => {
    const tight = { width: 2 * MIN_TILE_W + 50, height: 3000 } // fits 2 columns, not 3
    const plan = planDrop(twoCols, 'B', 'right', tight)
    expect(plan.mode).toBe('band')
    expect(plan.allowed).toBe(false)
  })

  it('falls back to a half split (gated on the target cell) for a fresh perpendicular drop', () => {
    const plan = planDrop(twoCols, 'B', 'top', bigContainer)
    expect(plan.mode).toBe('half')
    expect(plan.allowed).toBe(true)
    const blocked = planDrop(twoCols, 'B', 'top', { width: 4000, height: MIN_TILE_H })
    expect(blocked.allowed).toBe(false)
  })
})

describe('removeLeafRebalanced', () => {
  it('re-evens the columns after closing the middle of three', () => {
    const start: MosaicNode = {
      type: 'branch', direction: 'row', ratio: 1 / 3,
      first: leaf('A'),
      second: { type: 'branch', direction: 'row', ratio: 0.5, first: leaf('B'), second: leaf('C') },
    }
    const next = removeLeafRebalanced(start, 'B') as MosaicBranch
    expect(next.ratio).toBeCloseTo(0.5, 5)
    expect((next.first as { id: string }).id).toBe('A')
    expect((next.second as { id: string }).id).toBe('C')
  })

  it('preserves manual sizing in branches unrelated to the removal', () => {
    // left column rows manually 0.8; close a tile in the right column
    const start: MosaicNode = {
      type: 'branch', direction: 'row', ratio: 0.5,
      first: { type: 'branch', direction: 'column', ratio: 0.8, first: leaf('L1'), second: leaf('L2') },
      second: { type: 'branch', direction: 'column', ratio: 0.5, first: leaf('R1'), second: leaf('R2') },
    }
    const next = removeLeafRebalanced(start, 'R2') as MosaicBranch
    expect((next.first as MosaicBranch).ratio).toBe(0.8)
    expect((next.second as { id: string }).id).toBe('R1')
  })
})

describe('traversal helpers', () => {
  const root: MosaicNode = {
    type: 'branch', direction: 'row', ratio: 0.5,
    first: { type: 'branch', direction: 'column', ratio: 0.5, first: leaf('TL'), second: leaf('BL') },
    second: { type: 'branch', direction: 'column', ratio: 0.5, first: leaf('TR'), second: leaf('BR') },
  }

  it('collectLeaves returns every leaf', () => {
    expect(collectLeaves(root).map((l) => l.id).sort()).toEqual(['BL', 'BR', 'TL', 'TR'])
  })

  it('findLeaf locates a leaf by id', () => {
    expect(findLeaf(root, 'BR')).toMatchObject({ id: 'BR' })
    expect(findLeaf(root, 'nope')).toBeNull()
  })

  it('topLeftLeafId follows first; topRightLeafId follows the rightmost column top', () => {
    expect(topLeftLeafId(root)).toBe('TL')
    expect(topRightLeafId(root)).toBe('TR')
  })
})
