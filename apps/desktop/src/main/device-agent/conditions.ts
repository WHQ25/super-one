import type { DeviceUiNode } from '@superone/shared/device-agent'

/**
 * A claim about the screen, shared by `device_act`'s postcondition and
 * `device_wait_for`.
 *
 * One vocabulary for both on purpose: "did my tap work" and "has the screen caught
 * up yet" are the same question asked at different times, and giving them separate
 * grammars would mean the agent learns two.
 */
export type DeviceCondition =
  | { kind: 'exists'; ref?: string; label?: string; identifier?: string }
  | { kind: 'notExists'; ref?: string; label?: string; identifier?: string }
  | { kind: 'textEquals'; ref?: string; label?: string; identifier?: string; text: string }
  | { kind: 'textContains'; ref?: string; label?: string; identifier?: string; text: string }

/**
 * Conditions may name a node by ref, label, or identifier.
 *
 * Ref is exact but only valid within its own snapshot, which makes it useless to
 * `device_wait_for` — the thing being waited for usually does not exist yet, and
 * once it does the tree has been recaptured and the refs renumbered. Label and
 * identifier survive that, so they are what a wait should normally use.
 */
export function matchNode(root: DeviceUiNode, target: {
  ref?: string
  label?: string
  identifier?: string
}): DeviceUiNode | undefined {
  const stack: DeviceUiNode[] = [root]
  while (stack.length) {
    const node = stack.pop()!
    const hit = (target.ref && node.ref === target.ref)
      || (target.identifier && node.identifier === target.identifier)
      || (target.label && node.label === target.label)
    if (hit) return node
    for (const child of node.children ?? []) stack.push(child)
  }
  return undefined
}

export function evaluateCondition(root: DeviceUiNode, condition: DeviceCondition): boolean {
  const node = matchNode(root, condition)
  switch (condition.kind) {
    case 'exists': return node !== undefined
    case 'notExists': return node === undefined
    case 'textEquals': {
      if (!node) return false
      return node.label === condition.text || node.value === condition.text
    }
    case 'textContains': {
      if (!node) return false
      // Either field may carry the text: iOS puts a control's caption in the label
      // and its state in the value, and which one holds what varies by control.
      return (node.label?.includes(condition.text) ?? false)
        || (node.value?.includes(condition.text) ?? false)
    }
  }
}

/** A short human phrase for the condition, for tool summaries and errors. */
export function describeCondition(condition: DeviceCondition): string {
  const target = condition.ref ?? condition.identifier ?? condition.label ?? 'element'
  switch (condition.kind) {
    case 'exists': return `${target} exists`
    case 'notExists': return `${target} is gone`
    case 'textEquals': return `${target} reads "${condition.text}"`
    case 'textContains': return `${target} contains "${condition.text}"`
  }
}
