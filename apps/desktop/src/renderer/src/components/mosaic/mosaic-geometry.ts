import { LayoutControlError, type LayoutBox, type LayoutDivider } from '@superone/shared/layout-control'
import { DIVIDER_SIZE, MIN_TILE_W, MIN_TILE_H, MIN_RATIO, MAX_RATIO, subtreeRect, setRatioAtPath, type MosaicNode, type MosaicLeaf, type MosaicPath } from './mosaic-tree'

export function mosaicCapacity(area: LayoutBox): number {
  return Math.max(0, Math.floor((area.width + DIVIDER_SIZE) / (MIN_TILE_W + DIVIDER_SIZE)))
    * Math.max(0, Math.floor((area.height + DIVIDER_SIZE) / (MIN_TILE_H + DIVIDER_SIZE)))
}

export function capacityError(area: LayoutBox): never {
  throw new LayoutControlError('unavailable', `Sessions cannot fit: current capacity is ${mosaicCapacity(area)} (${area.width} × ${area.height}px; minimum tile ${MIN_TILE_W} × ${MIN_TILE_H}px). Use fewer sessions, widen the window or hide the sidebar.`)
}

/** Equal tracks, including the fixed dividers in each subtree's share. */
function tracks(nodes: MosaicNode[], direction: 'row' | 'column', extent: number): MosaicNode {
  if (nodes.length === 1) return nodes[0]!
  const count = Math.floor(nodes.length / 2)
  const unit = (extent - (nodes.length - 1) * DIVIDER_SIZE) / nodes.length
  const firstExtent = unit * count + (count - 1) * DIVIDER_SIZE
  return { type: 'branch', direction, ratio: firstExtent / (extent - DIVIDER_SIZE),
    first: tracks(nodes.slice(0, count), direction, firstExtent),
    second: tracks(nodes.slice(count), direction, extent - DIVIDER_SIZE - firstExtent) }
}

/** Prefer columns; distribute the remainder across balanced rows in list order. */
export function arrangeMosaic(leaves: MosaicLeaf[], area: LayoutBox): MosaicNode {
  if (!leaves.length) throw new LayoutControlError('invalid', 'sessionIds must not be empty.')
  if (leaves.length > mosaicCapacity(area)) capacityError(area)
  const columns = Math.floor((area.width + DIVIDER_SIZE) / (MIN_TILE_W + DIVIDER_SIZE))
  const rows = Math.ceil(leaves.length / columns)
  const nodes: MosaicNode[] = []
  let offset = 0
  for (let row = 0; row < rows; row++) {
    const count = Math.ceil((leaves.length - offset) / (rows - row))
    nodes.push(tracks(leaves.slice(offset, offset + count), 'row', area.width))
    offset += count
  }
  return tracks(nodes, 'column', area.height)
}

/** IDs depend on topology/leaf identity, never ratios. No old path can target a new divider. */
let nextDividerId = 0
const dividerIds = new Map<string, string>()
export function mosaicDividers(root: MosaicNode): (LayoutDivider & LayoutBox & { path: MosaicPath })[] {
  const ids = new Map<MosaicNode, string>()
  const identity = (node: MosaicNode): string => {
    const id = node.type === 'leaf' ? JSON.stringify(node.id) : `[${node.direction},${identity(node.first)},${identity(node.second)}]`
    ids.set(node, id)
    return id
  }
  identity(root)
  const out: ReturnType<typeof mosaicDividers> = []
  const walk = (node: MosaicNode, path: MosaicPath) => {
    if (node.type === 'leaf') return
    const identity = ids.get(node)!
    let id = dividerIds.get(identity)
    if (!id) {
      id = `divider-${++nextDividerId}`
      dividerIds.set(identity, id)
      if (dividerIds.size > 512) dividerIds.delete(dividerIds.keys().next().value!)
    }
    out.push({ id, path, direction: node.direction, ratio: node.ratio, x: 0, y: 0, width: 0, height: 0 })
    walk(node.first, [...path, 'first'])
    walk(node.second, [...path, 'second'])
  }
  walk(root, [])
  return out
}

export function mosaicGeometry(root: MosaicNode, area: LayoutBox) {
  const full = { x: 0, y: 0, w: area.width, h: area.height }
  const tiles: (LayoutBox & { leaf: MosaicLeaf })[] = []
  const walk = (node: MosaicNode, path: MosaicPath) => {
    if (node.type === 'branch') { walk(node.first, [...path, 'first']); walk(node.second, [...path, 'second']); return }
    const r = subtreeRect(root, path, full)
    tiles.push({ leaf: node, x: r.x, y: r.y, width: r.w, height: r.h })
  }
  walk(root, [])
  const dividers = mosaicDividers(root).map(({ path, ...divider }) => {
    const r = subtreeRect(root, path, full)
    const horizontal = divider.direction === 'row'
    return { ...divider, x: r.x + (horizontal ? (r.w - DIVIDER_SIZE) * divider.ratio : 0),
      y: r.y + (horizontal ? 0 : (r.h - DIVIDER_SIZE) * divider.ratio),
      width: horizontal ? DIVIDER_SIZE : r.w, height: horizontal ? r.h : DIVIDER_SIZE }
  })
  return { tiles, dividers }
}

export function assertMosaicFits(root: MosaicNode, area: LayoutBox): void {
  if (mosaicGeometry(root, area).tiles.some(t => t.width + 0.001 < MIN_TILE_W || t.height + 0.001 < MIN_TILE_H)) {
    throw new LayoutControlError('unavailable', `The proposed proportions cannot fit minimum tile sizes in the current space (capacity ${mosaicCapacity(area)}). Enlarge the window, hide the sidebar, close tiles, or adjust the divider ratios together.`)
  }
}

export function resizeMosaic(root: MosaicNode, changes: { id: string; ratio: number }[], area: LayoutBox): MosaicNode {
  if (!Array.isArray(changes) || !changes.length) throw new LayoutControlError('invalid', 'resize_splits needs a non-empty dividers list from layout_snapshot.')
  const byId = new Map(mosaicDividers(root).map(d => [d.id, d.path]))
  const seen = new Set<string>()
  let next = root
  for (const change of changes) {
    if (!change || seen.has(change.id) || !Number.isFinite(change.ratio) || change.ratio < MIN_RATIO || change.ratio > MAX_RATIO) {
      throw new LayoutControlError('invalid', `Each divider needs a unique id and a finite ratio in [${MIN_RATIO}, ${MAX_RATIO}].`)
    }
    const path = byId.get(change.id)
    if (!path) throw new LayoutControlError('not_found', 'Unknown or stale divider id. Read layout_snapshot for current ids.')
    seen.add(change.id)
    next = setRatioAtPath(next, path, change.ratio)
  }
  assertMosaicFits(next, area)
  return next
}
