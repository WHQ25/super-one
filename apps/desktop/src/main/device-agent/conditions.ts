import type { DeviceUiNode } from '@superone/shared/device-agent'
import { DeviceAgentError } from './types'

/**
 * A claim about the screen, shared by `device_act`'s postcondition and
 * `device_wait_for`.
 *
 * One vocabulary for both on purpose: "did my tap work" and "has the screen caught
 * up yet" are the same question asked at different times, and giving them separate
 * grammars would mean the agent learns two.
 */
export type DeviceCondition =
  | ({ kind: 'exists' } & DeviceConditionTarget)
  | ({ kind: 'notExists' } & DeviceConditionTarget)
  | ({ kind: 'textEquals'; text: string } & DeviceConditionTarget)
  | ({ kind: 'textContains'; text: string } & DeviceConditionTarget)

/**
 * Which element the claim is about.
 *
 * At least one field, always — that is the whole reason this is a named type. A
 * target with nothing in it matches no node, which `notExists` then reads as "yes,
 * it is gone" on a screen nobody looked at, and `exists` can never satisfy at all.
 * The type says "at least one" as loosely as TypeScript allows; `parseCondition`
 * is what actually enforces it, because both tool surfaces take raw JSON.
 */
export interface DeviceConditionTarget {
  ref?: string
  label?: string
  identifier?: string
}

const CONDITION_KINDS = ['exists', 'notExists', 'textEquals', 'textContains'] as const

/**
 * Turn whatever the model sent into a condition, or say why it is not one.
 *
 * Validation lives here rather than in the Zod schema because the stdio tool surface
 * (Codex / ACP / OpenCode) hands `execute` raw JSON that no Zod schema ever sees,
 * and because "at least one of ref/label/identifier" is not expressible in JSON
 * Schema in a form every harness enforces. Rejecting is the point: a condition that
 * cannot be satisfied, or one that is trivially satisfied, is worse than an error —
 * it answers a question about a screen it never inspected.
 */
export function parseCondition(raw: unknown): DeviceCondition {
  const value = (raw ?? {}) as Record<string, unknown>
  const kind = value.kind
  if (typeof kind !== 'string' || !(CONDITION_KINDS as readonly string[]).includes(kind)) {
    throw new DeviceAgentError(
      'INVALID_ACTION',
      `A condition needs kind to be one of ${CONDITION_KINDS.join(', ')}.`,
    )
  }

  const target: DeviceConditionTarget = {}
  if (typeof value.ref === 'string' && value.ref) target.ref = value.ref
  if (typeof value.label === 'string' && value.label) target.label = value.label
  if (typeof value.identifier === 'string' && value.identifier) target.identifier = value.identifier
  if (target.ref === undefined && target.label === undefined && target.identifier === undefined) {
    throw new DeviceAgentError(
      'INVALID_ACTION',
      `A ${kind} condition must name the element with ref, label or identifier — `
        + 'text alone is not a target. Without one it matches nothing, which would report '
        + '"already gone" for a screen that was never inspected.',
    )
  }

  if (kind === 'exists') return { ...target, kind }
  if (kind === 'notExists') return { ...target, kind }
  if (typeof value.text !== 'string' || value.text === '') {
    throw new DeviceAgentError('INVALID_ACTION', `${kind} needs text to compare against.`)
  }
  if (kind === 'textEquals') return { ...target, kind, text: value.text }
  return { ...target, kind: 'textContains', text: value.text }
}

/**
 * Conditions may name a node by ref, label, or identifier.
 *
 * Ref is exact but only valid within its own snapshot, which makes it useless to
 * `device_wait_for` — the thing being waited for usually does not exist yet, and
 * once it does the tree has been recaptured and the refs renumbered. Label and
 * identifier survive that, so they are what a wait should normally use.
 */
export function matchNode(root: DeviceUiNode, target: DeviceConditionTarget): DeviceUiNode | undefined {
  if (target.ref === undefined && target.label === undefined && target.identifier === undefined) {
    // Unreachable through the tools, which parse first. Guarding anyway: the caller
    // that skips the parse would otherwise get "no match" back, and every kind reads
    // no-match as a definite answer.
    throw new DeviceAgentError(
      'INVALID_ACTION',
      'A condition target must name the element with ref, label or identifier.',
    )
  }
  const stack: DeviceUiNode[] = [root]
  while (stack.length) {
    const node = stack.pop()!
    const hit = (target.ref !== undefined && node.ref === target.ref)
      || (target.identifier !== undefined && node.identifier === target.identifier)
      || (target.label !== undefined && node.label === target.label)
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
