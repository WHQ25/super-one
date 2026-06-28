export type ShrinkEdge = 'right' | 'left' | 'bottom' | 'top'

export interface GridTile {
  id: string
  projectPath: string
  sessionId: string
  row: number
  col: number
}

export const MIN_SLOT_W = 380
export const MIN_SLOT_H = 480

export function computeCapacity(
  width: number,
  height: number,
  minW: number = MIN_SLOT_W,
  minH: number = MIN_SLOT_H,
): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.floor(width / minW)),
    rows: Math.max(1, Math.floor(height / minH)),
  }
}

interface EvictResult {
  kept: GridTile[]
  evicted: GridTile[]
}

function peelColumns(tiles: GridTile[], cols: number, targetCols: number, edge: 'right' | 'left', focusedId: string | null): EvictResult {
  let cur = cols
  let kept = tiles.map((t) => ({ ...t }))
  const evicted: GridTile[] = []
  while (cur > targetCols) {
    const edgeCol = edge === 'right' ? cur - 1 : 0
    const survCol = edge === 'right' ? edgeCol - 1 : edgeCol + 1
    const focus = focusedId ? kept.find((t) => t.id === focusedId) : undefined
    if (focus && focus.col === edgeCol && survCol >= 0) {
      const neighbor = kept.find((t) => t.col === survCol && t.row === focus.row)
      if (neighbor) {
        focus.col = survCol
        neighbor.col = edgeCol
      } else {
        focus.col = survCol
      }
    }
    for (const t of kept) if (t.col === edgeCol) evicted.push(t)
    kept = kept.filter((t) => t.col !== edgeCol)
    if (edge === 'left') for (const t of kept) t.col -= 1
    cur -= 1
  }
  return { kept, evicted }
}

function peelRows(tiles: GridTile[], rows: number, targetRows: number, edge: 'top' | 'bottom', focusedId: string | null): EvictResult {
  let cur = rows
  let kept = tiles.map((t) => ({ ...t }))
  const evicted: GridTile[] = []
  while (cur > targetRows) {
    const edgeRow = edge === 'bottom' ? cur - 1 : 0
    const survRow = edge === 'bottom' ? edgeRow - 1 : edgeRow + 1
    const focus = focusedId ? kept.find((t) => t.id === focusedId) : undefined
    if (focus && focus.row === edgeRow && survRow >= 0) {
      const neighbor = kept.find((t) => t.row === survRow && t.col === focus.col)
      if (neighbor) {
        focus.row = survRow
        neighbor.row = edgeRow
      } else {
        focus.row = survRow
      }
    }
    for (const t of kept) if (t.row === edgeRow) evicted.push(t)
    kept = kept.filter((t) => t.row !== edgeRow)
    if (edge === 'top') for (const t of kept) t.row -= 1
    cur -= 1
  }
  return { kept, evicted }
}

/**
 * Shrink a tile grid to a smaller capacity by peeling whole tracks from the
 * shrinking edge(s). The focused tile is never evicted: when its track is
 * peeled it first swaps places with the same-position tile in the adjacent
 * surviving track (which is then evicted in its stead).
 */
export function reflowToCapacity(
  tiles: GridTile[],
  cols: number,
  rows: number,
  targetCols: number,
  targetRows: number,
  focusedId: string | null,
  hEdge: 'right' | 'left',
  vEdge: 'top' | 'bottom',
): EvictResult {
  const evicted: GridTile[] = []
  let kept = tiles
  if (targetCols < cols) {
    const r = peelColumns(kept, cols, targetCols, hEdge, focusedId)
    kept = r.kept
    evicted.push(...r.evicted)
  }
  if (targetRows < rows) {
    const r = peelRows(kept, rows, targetRows, vEdge, focusedId)
    kept = r.kept
    evicted.push(...r.evicted)
  }
  return { kept, evicted }
}
