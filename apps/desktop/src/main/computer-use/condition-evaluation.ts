import { findNode } from './outline'
import type { Condition } from './types'

export function evaluateCondition(
  condition: Condition,
  outline: import('./types').UiOutlineNode,
): boolean {
  switch (condition.kind) {
    case 'exists':
      return !!findNode(outline, condition.ref)
    case 'notExists':
      return !findNode(outline, condition.ref)
    case 'textEquals': {
      const n = findNode(outline, condition.ref)
      return !!n && (n.name === condition.text || n.value === condition.text)
    }
    case 'textContains': {
      const n = findNode(outline, condition.ref)
      if (!n) return false
      return (n.name ?? '').includes(condition.text) || (n.value ?? '').includes(condition.text)
    }
    case 'valueEquals': {
      const n = findNode(outline, condition.ref)
      return !!n && n.value === condition.value
    }
    default: {
      const _e: never = condition
      return _e
    }
  }
}

interface ConditionBinding {
  condition: Condition
  target?: import('./types').UiOutlineNode
  matchName: boolean
}

type ConditionTargetResolution =
  | { status: 'found'; node: import('./types').UiOutlineNode }
  | { status: 'missing' | 'ambiguous' }

export function bindCondition(
  condition: Condition,
  outline: import('./types').UiOutlineNode,
): ConditionBinding {
  return {
    condition,
    target: findNode(outline, condition.ref),
    // Text conditions may intentionally wait for either name or value to change.
    matchName: condition.kind !== 'textEquals' && condition.kind !== 'textContains',
  }
}

export function evaluateBoundCondition(
  binding: ConditionBinding,
  outline: import('./types').UiOutlineNode,
): boolean {
  if (!binding.target) {
    // Preserve missing-ref behavior for callers waiting on a future raw ref.
    return evaluateCondition(binding.condition, outline)
  }

  const resolution = resolveConditionTarget(binding, outline)
  if (binding.condition.kind === 'notExists') {
    return resolution.status === 'missing'
  }
  if (resolution.status !== 'found') return false

  const node = resolution.node
  switch (binding.condition.kind) {
    case 'exists':
      return true
    case 'textEquals':
      return node.name === binding.condition.text || node.value === binding.condition.text
    case 'textContains':
      return (node.name ?? '').includes(binding.condition.text)
        || (node.value ?? '').includes(binding.condition.text)
    case 'valueEquals':
      return node.value === binding.condition.value
    default: {
      const _condition: never = binding.condition
      return _condition
    }
  }
}

function resolveConditionTarget(
  binding: ConditionBinding,
  outline: import('./types').UiOutlineNode,
): ConditionTargetResolution {
  const expected = binding.target!
  const candidates: import('./types').UiOutlineNode[] = []
  const stack = [outline]
  while (stack.length) {
    const node = stack.pop()!
    if (
      node.role === expected.role
      && node.pictureOnly === expected.pictureOnly
      && (!binding.matchName || node.name === expected.name)
    ) {
      candidates.push(node)
    }
    if (node.children) stack.push(...node.children)
  }

  if (candidates.length === 0) return { status: 'missing' }
  if (candidates.length === 1) return { status: 'found', node: candidates[0]! }
  if (!expected.bounds) return { status: 'ambiguous' }

  const ranked = candidates
    .filter((node) => node.bounds)
    .map((node) => ({ node, distance: boundsDistance(expected.bounds!, node.bounds!) }))
    .sort((a, b) => a.distance - b.distance)
  if (ranked.length === 0) return { status: 'ambiguous' }
  if (ranked.length === 1 || ranked[0]!.distance + 0.5 < ranked[1]!.distance) {
    return { status: 'found', node: ranked[0]!.node }
  }
  return { status: 'ambiguous' }
}

function boundsDistance(a: import('./types').Bounds, b: import('./types').Bounds): number {
  const ax = a.x + a.width / 2
  const ay = a.y + a.height / 2
  const bx = b.x + b.width / 2
  const by = b.y + b.height / 2
  return Math.hypot(ax - bx, ay - by, a.width - b.width, a.height - b.height)
}
