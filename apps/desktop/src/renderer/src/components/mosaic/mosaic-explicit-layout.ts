import { LayoutControlError } from '@superone/shared/layout-control'
import { MAX_RATIO, MIN_RATIO, type MosaicLeaf, type MosaicNode } from './mosaic-tree'

/** List indices keep qualified identities in sessionIds and reuse batch resolution. */
export function explicitMosaicLayout(layout: unknown, leaves: MosaicLeaf[]): MosaicNode {
  const used = new Set<number>()
  const invalid = (message: string): never => { throw new LayoutControlError('invalid', message) }
  const walk = (value: unknown, depth: number): MosaicNode => {
    if (typeof value === 'number') {
      if (!Number.isInteger(value) || value < 0 || value >= leaves.length || used.has(value)) {
        return invalid('layout leaves must be unique 0-based indices into sessionIds.')
      }
      used.add(value)
      return leaves[value]!
    }
    if (depth > 64 || !value || typeof value !== 'object' || Array.isArray(value)) {
      return invalid('layout needs a sessionIds index or a nested split (maximum depth 64).')
    }
    const branch = value as Record<string, unknown>
    if (!['row', 'column'].includes(branch.direction as string) || Object.keys(branch).some(key => !['direction', 'ratio', 'first', 'second'].includes(key))) {
      return invalid('Each layout split needs direction row (left/right) or column (top/bottom), first, second and an optional ratio.')
    }
    const ratio = branch.ratio === undefined ? 0.5 : branch.ratio
    if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < MIN_RATIO || ratio > MAX_RATIO) {
      return invalid(`Each layout ratio must be finite and in [${MIN_RATIO}, ${MAX_RATIO}].`)
    }
    return { type: 'branch', direction: branch.direction as 'row' | 'column', ratio,
      first: walk(branch.first, depth + 1), second: walk(branch.second, depth + 1) }
  }
  const root = walk(layout, 0)
  if (used.size !== leaves.length) invalid('layout must use every sessionIds index exactly once.')
  return root
}
