import { selectAppRoot } from './root-selection'
import type { Condition, UiOutlineNode, UiRootIdentity } from './types'

export type NewRootCondition = Extract<Condition, { kind: 'newRoot' }>

export function newAppRoots(base: UiRootIdentity, knownIds: readonly string[], roots: UiRootIdentity[]): UiRootIdentity[] {
  const known = new Set(knownIds)
  return roots.filter((root) => root.bundleId === base.bundleId && root.pid === base.pid
    && !known.has(root.rootId) && root.visible && !root.minimized)
}

export function newRootMatches(condition: NewRootCondition, root: UiRootIdentity, outline?: UiOutlineNode): boolean {
  if (condition.title !== undefined && root.title !== condition.title) return false
  if (condition.rootKind !== undefined && root.kind !== condition.rootKind) return false
  if (condition.text === undefined) return true
  if (!outline) return false
  const contains = (node: UiOutlineNode): boolean => !node.secure && !/secure|password/i.test(node.role)
    && (!!node.name?.includes(condition.text!) || !!node.value?.includes(condition.text!) || !!node.children?.some(contains))
  return contains(outline)
}

export function selectNewAppRoot(base: UiRootIdentity, knownIds: readonly string[], roots: UiRootIdentity[], condition?: NewRootCondition): UiRootIdentity | undefined {
  const candidates = newAppRoots(base, knownIds, roots)
  const matching = condition ? candidates.filter((root) => newRootMatches({ ...condition, text: undefined }, root)) : candidates
  return selectAppRoot(matching)
}
