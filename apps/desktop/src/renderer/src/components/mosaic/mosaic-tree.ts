export type DropEdge = 'left' | 'right' | 'top' | 'bottom'

export interface MosaicLeaf {
  type: 'leaf'
  id: string
  projectPath: string
  sessionId: string
}

export interface MosaicBranch {
  type: 'branch'
  direction: 'row' | 'column'
  ratio: number
  first: MosaicNode
  second: MosaicNode
}

export type MosaicNode = MosaicLeaf | MosaicBranch
export type MosaicPath = ('first' | 'second')[]

export const MIN_RATIO = 0.05
export const MAX_RATIO = 0.95

export const MIN_TILE_W = 360
export const MIN_TILE_H = 420
export const DIVIDER_SIZE = 1

export interface Size {
  w: number
  h: number
}

export function measureMin(node: MosaicNode): Size {
  if (node.type === 'leaf') return { w: MIN_TILE_W, h: MIN_TILE_H }
  const a = measureMin(node.first)
  const b = measureMin(node.second)
  return node.direction === 'row'
    ? { w: a.w + b.w + DIVIDER_SIZE, h: Math.max(a.h, b.h) }
    : { w: Math.max(a.w, b.w), h: a.h + b.h + DIVIDER_SIZE }
}

export function canSplit(size: { width: number; height: number }, edge: DropEdge): boolean {
  return edge === 'left' || edge === 'right'
    ? size.width >= 2 * MIN_TILE_W + DIVIDER_SIZE
    : size.height >= 2 * MIN_TILE_H + DIVIDER_SIZE
}

export function clampRatioToMin(ratio: number, size: number, firstMin: number, secondMin: number): number {
  const avail = size - DIVIDER_SIZE
  let r = ratio
  if (avail > 0) {
    const lo = firstMin / avail
    const hi = 1 - secondMin / avail
    if (lo <= hi) r = Math.min(hi, Math.max(lo, r))
  }
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, r))
}

export function makeLeaf(id: string, projectPath: string, sessionId: string): MosaicLeaf {
  return { type: 'leaf', id, projectPath, sessionId }
}

export function leafCount(node: MosaicNode | null): number {
  if (!node) return 0
  if (node.type === 'leaf') return 1
  return leafCount(node.first) + leafCount(node.second)
}

export function collectLeaves(node: MosaicNode | null): MosaicLeaf[] {
  if (!node) return []
  if (node.type === 'leaf') return [node]
  return [...collectLeaves(node.first), ...collectLeaves(node.second)]
}

export function findLeaf(node: MosaicNode | null, id: string): MosaicLeaf | null {
  if (!node) return null
  if (node.type === 'leaf') return node.id === id ? node : null
  return findLeaf(node.first, id) ?? findLeaf(node.second, id)
}

function branchFor(edge: DropEdge, target: MosaicNode, leaf: MosaicLeaf): MosaicBranch {
  switch (edge) {
    case 'left':
      return { type: 'branch', direction: 'row', ratio: 0.5, first: leaf, second: target }
    case 'right':
      return { type: 'branch', direction: 'row', ratio: 0.5, first: target, second: leaf }
    case 'top':
      return { type: 'branch', direction: 'column', ratio: 0.5, first: leaf, second: target }
    case 'bottom':
      return { type: 'branch', direction: 'column', ratio: 0.5, first: target, second: leaf }
  }
}

export function insertBeside(root: MosaicNode, targetId: string, edge: DropEdge, leaf: MosaicLeaf): MosaicNode {
  if (root.type === 'leaf') {
    return root.id === targetId ? branchFor(edge, root, leaf) : root
  }
  return {
    ...root,
    first: insertBeside(root.first, targetId, edge, leaf),
    second: insertBeside(root.second, targetId, edge, leaf),
  }
}

/**
 * Path to the top of the maximal `dir`-direction spine that contains the leaf at
 * `targetPath`. If the target's parent is not a `dir` branch the spine is just
 * the target itself (a fresh split will create a lone 2-track group there).
 */
function maximalSpineTop(root: MosaicNode, targetPath: MosaicPath, dir: 'row' | 'column'): MosaicPath {
  let topPath = targetPath
  while (topPath.length > 0) {
    const parent = nodeAtPath(root, topPath.slice(0, -1))
    if (parent.type === 'branch' && parent.direction === dir) topPath = topPath.slice(0, -1)
    else break
  }
  return topPath
}

function spineSegments(node: MosaicNode, dir: 'row' | 'column'): number {
  if (node.type === 'branch' && node.direction === dir) return spineSegments(node.first, dir) + spineSegments(node.second, dir)
  return 1
}

function rebalanceSpine(node: MosaicNode, dir: 'row' | 'column'): MosaicNode {
  if (node.type !== 'branch' || node.direction !== dir) return node
  const left = spineSegments(node.first, dir)
  const right = spineSegments(node.second, dir)
  return {
    ...node,
    ratio: left / (left + right),
    first: rebalanceSpine(node.first, dir),
    second: rebalanceSpine(node.second, dir),
  }
}

/**
 * Insert a leaf beside a target, then re-balance the local track group it joins:
 * the maximal same-direction spine containing the new branch is split into equal
 * tracks. So adding a 3rd column to 2 columns yields even thirds (50/25/25 → 1/3
 * each), and adding a 3rd row inside one column evens that column's rows — while
 * a fresh perpendicular split stays a local 50/50 and unrelated branches keep
 * their manual sizing.
 */
export function addLeaf(root: MosaicNode, targetId: string, edge: DropEdge, leaf: MosaicLeaf): MosaicNode {
  const targetPath = pathToLeaf(root, targetId)
  if (!targetPath) return root
  const dir: 'row' | 'column' = edge === 'left' || edge === 'right' ? 'row' : 'column'
  const topPath = maximalSpineTop(root, targetPath, dir)
  const inserted = insertBeside(root, targetId, edge, leaf)
  const sub = nodeAtPath(inserted, topPath)
  return replaceAtPath(inserted, topPath, rebalanceSpine(sub, dir))
}

export function spineSegmentList(node: MosaicNode, dir: 'row' | 'column'): MosaicNode[] {
  if (node.type === 'branch' && node.direction === dir) return [...spineSegmentList(node.first, dir), ...spineSegmentList(node.second, dir)]
  return [node]
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** On-screen rect of the subtree at `path`, derived from the tree ratios — mirrors the flex layout (grow = ratio, basis 0, fixed dividers). */
export function subtreeRect(root: MosaicNode, path: MosaicPath, rect: Rect): Rect {
  let cur: MosaicNode = root
  let r = rect
  for (const step of path) {
    if (cur.type !== 'branch') break
    if (cur.direction === 'row') {
      const avail = Math.max(0, r.w - DIVIDER_SIZE)
      const fw = avail * cur.ratio
      r = step === 'first' ? { x: r.x, y: r.y, w: fw, h: r.h } : { x: r.x + fw + DIVIDER_SIZE, y: r.y, w: avail - fw, h: r.h }
    } else {
      const avail = Math.max(0, r.h - DIVIDER_SIZE)
      const fh = avail * cur.ratio
      r = step === 'first' ? { x: r.x, y: r.y, w: r.w, h: fh } : { x: r.x, y: r.y + fh + DIVIDER_SIZE, w: r.w, h: avail - fh }
    }
    cur = step === 'first' ? cur.first : cur.second
  }
  return r
}

export interface DropPlan {
  allowed: boolean
  mode: 'half' | 'band'
  edge: DropEdge
  targetTileId: string | null
  axis?: 'x' | 'y'
  index?: number
  count?: number
  regionPath?: MosaicPath
  targetPath?: MosaicPath
}

/**
 * Decide whether a session may be dropped beside `targetId` on `edge`, and
 * describe the preview geometry. If the drop extends an existing same-direction
 * track group (the target's local row/column spine), the preview is a `band`
 * sized to the post-insert fraction (1/(N+1)) of that group's region, gated on
 * the group fitting N+1 minimum tiles. Otherwise it's a local `half` split,
 * gated on the target cell fitting two minimum tiles.
 */
export function planDrop(
  root: MosaicNode | null,
  targetId: string | null,
  edge: DropEdge,
  container: { width: number; height: number },
): DropPlan {
  const horizontal = edge === 'left' || edge === 'right'
  const minTile = horizontal ? MIN_TILE_W : MIN_TILE_H
  const full: Rect = { x: 0, y: 0, w: container.width, h: container.height }
  if (!root || !targetId) {
    const extent = horizontal ? container.width : container.height
    return { allowed: extent >= 2 * minTile + DIVIDER_SIZE, mode: 'half', edge, targetTileId: targetId ?? null, targetPath: [] }
  }
  const targetPath = pathToLeaf(root, targetId)
  if (!targetPath) return { allowed: false, mode: 'half', edge, targetTileId: targetId, targetPath: [] }
  const dir: 'row' | 'column' = horizontal ? 'row' : 'column'
  const parent = targetPath.length ? nodeAtPath(root, targetPath.slice(0, -1)) : null
  const onSpine = parent !== null && parent.type === 'branch' && parent.direction === dir
  if (!onSpine) {
    const tRect = subtreeRect(root, targetPath, full)
    const extent = horizontal ? tRect.w : tRect.h
    return { allowed: extent >= 2 * minTile + DIVIDER_SIZE, mode: 'half', edge, targetTileId: targetId, targetPath }
  }
  const topPath = maximalSpineTop(root, targetPath, dir)
  const segs = spineSegmentList(nodeAtPath(root, topPath), dir)
  const i = segs.findIndex((s) => findLeaf(s, targetId))
  const count = segs.length + 1
  const index = edge === 'right' || edge === 'bottom' ? i + 1 : i
  const region = subtreeRect(root, topPath, full)
  const extent = horizontal ? region.w : region.h
  const allowed = extent >= count * minTile + (count - 1) * DIVIDER_SIZE
  return { allowed, mode: 'band', edge, targetTileId: targetId, axis: horizontal ? 'x' : 'y', index, count, regionPath: topPath }
}

function pathToLeaf(node: MosaicNode, id: string): MosaicPath | null {
  if (node.type === 'leaf') return node.id === id ? [] : null
  const f = pathToLeaf(node.first, id)
  if (f) return ['first', ...f]
  const s = pathToLeaf(node.second, id)
  if (s) return ['second', ...s]
  return null
}

export function nodeAtPath(node: MosaicNode, path: MosaicPath): MosaicNode {
  let cur = node
  for (const p of path) {
    if (cur.type !== 'branch') break
    cur = p === 'first' ? cur.first : cur.second
  }
  return cur
}

function replaceAtPath(node: MosaicNode, path: MosaicPath, replacement: MosaicNode): MosaicNode {
  if (path.length === 0) return replacement
  if (node.type !== 'branch') return node
  const [head, ...rest] = path
  return head === 'first'
    ? { ...node, first: replaceAtPath(node.first, rest, replacement) }
    : { ...node, second: replaceAtPath(node.second, rest, replacement) }
}

/**
 * Remove a leaf and re-equalize the track group it left behind: the maximal
 * same-direction spine that contained the removed leaf's parent is rebalanced
 * to equal tracks, so closing the middle of 3 even columns yields 2 even
 * columns. Sizing inside unrelated branches is preserved.
 */
export function removeLeafRebalanced(root: MosaicNode, id: string): MosaicNode | null {
  const path = pathToLeaf(root, id)
  if (!path || path.length === 0) return removeLeaf(root, id)
  const parentPath = path.slice(0, -1)
  const parent = nodeAtPath(root, parentPath)
  if (parent.type !== 'branch') return removeLeaf(root, id)
  const dir = parent.direction
  let topPath = parentPath
  while (topPath.length > 0) {
    const cand = nodeAtPath(root, topPath.slice(0, -1))
    if (cand.type === 'branch' && cand.direction === dir) topPath = topPath.slice(0, -1)
    else break
  }
  const removed = removeLeaf(root, id)
  if (!removed) return null
  const sub = nodeAtPath(removed, topPath)
  return replaceAtPath(removed, topPath, rebalanceSpine(sub, dir))
}

export function removeLeaf(root: MosaicNode, id: string): MosaicNode | null {
  if (root.type === 'leaf') return root.id === id ? null : root
  const first = removeLeaf(root.first, id)
  const second = removeLeaf(root.second, id)
  if (first === null) return second
  if (second === null) return first
  if (first === root.first && second === root.second) return root
  return { ...root, first, second }
}

export function setRatioAtPath(root: MosaicNode, path: MosaicPath, ratio: number): MosaicNode {
  const clamped = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
  if (path.length === 0) {
    if (root.type !== 'branch') return root
    return { ...root, ratio: clamped }
  }
  if (root.type !== 'branch') return root
  const [head, ...rest] = path
  if (head === 'first') return { ...root, first: setRatioAtPath(root.first, rest, ratio) }
  return { ...root, second: setRatioAtPath(root.second, rest, ratio) }
}

export function computeDropEdge(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): DropEdge {
  const x = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5
  const y = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5
  const dist: Record<DropEdge, number> = { left: x, right: 1 - x, top: y, bottom: 1 - y }
  let edge: DropEdge = 'right'
  for (const e of ['left', 'right', 'top', 'bottom'] as DropEdge[]) if (dist[e] < dist[edge]) edge = e
  return edge
}

export function topLeftLeafId(node: MosaicNode): string {
  let cur = node
  while (cur.type === 'branch') cur = cur.first
  return cur.id
}

export function topRightLeafId(node: MosaicNode): string {
  let cur = node
  while (cur.type === 'branch') cur = cur.direction === 'row' ? cur.second : cur.first
  return cur.id
}
