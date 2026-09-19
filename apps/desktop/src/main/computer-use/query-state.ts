import { targetIdentity } from './app-identity'
import { expandSubtree, findNode, searchOutline } from './outline'
import { ComputerUseError, type ComputerUseState, type QueryResult } from './types'

export function queryState(state: ComputerUseState, stateId: string, op: 'search' | 'expand' | 'inspect', args: { text?: string; ref?: string; depth?: number }): QueryResult {
  const root = targetIdentity(state.root)
  // Query is read-only on cached state — no grant re-check beyond existence,
  // but still require the feature be enabled. Refs are state-scoped.

  if (op === 'search') {
    if (!args.text) {
      throw new ComputerUseError('INVALID_ACTION', 'search requires text')
    }
    return { matches: searchOutline(state.outline, args.text), root }
  }
  if (op === 'expand') {
    if (!args.ref) {
      throw new ComputerUseError('INVALID_ACTION', 'expand requires ref')
    }
    const subtree = expandSubtree(state.outline, args.ref, args.depth ?? 3)
    if (!subtree) {
      throw new ComputerUseError('UNKNOWN_REF', `ref ${args.ref} not in ${stateId}`, {
        ref: args.ref,
        stateId,
      })
    }
    return { subtree, root }
  }
  // inspect
  if (!args.ref) {
    throw new ComputerUseError('INVALID_ACTION', 'inspect requires ref')
  }
  const element = findNode(state.outline, args.ref)
  if (!element) {
    throw new ComputerUseError('UNKNOWN_REF', `ref ${args.ref} not in ${stateId}`, {
      ref: args.ref,
      stateId,
    })
  }
  // Return node without children for a compact inspect.
  const { children: _c, ...rest } = element
  return { element: rest, root }
}
