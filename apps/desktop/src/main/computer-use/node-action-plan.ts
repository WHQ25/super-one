import type { CapabilityTier, Condition, UiAction, UiOutlineNode } from './types'

type NodeIntent =
  | { kind: 'press' | 'enter' | 'select' | 'open' }
  | { kind: 'setText' | 'append'; text: string }
  | { kind: 'scroll'; dy: number }

export interface NodeActionPlan {
  actions: UiAction[]
  expect?: Condition
}

const TEXT_ROLES = new Set(['textfield', 'textarea', 'searchfield', 'combobox', 'textbox', 'searchbox', 'group'])

/** Resolve an observed intent to an executable computer_act transaction.
 * Candidate construction and dispatch use this same capability map; the
 * platform routes each action to AX or posted input itself.
 */
export function planNodeAction(node: UiOutlineNode | undefined, intent: NodeIntent, tier: CapabilityTier | null): NodeActionPlan | undefined {
  if (!node || !tier) return
  const role = node.role.replace(/^AX/, '').toLowerCase()
  if (tier === 'read' || node.enabled === false || node.pictureOnly || node.secure || /secure|password/.test(role)) return
  const can = node.capabilities ?? {}
  if ((intent.kind === 'select' || intent.kind === 'open') && can[intent.kind]) {
    return { actions: [{ type: intent.kind, ref: node.ref }] }
  }
  if (intent.kind === 'press' && can.press) {
    return { actions: [{ type: 'press', ref: node.ref }] }
  }
  // A scroll with a ref becomes a scroll bar value write, which works on a
  // background app where posted wheel events do not.
  if (intent.kind === 'scroll' && can.scroll && node.bounds && node.bounds.width > 0 && node.bounds.height > 0) {
    return { actions: [{ type: 'scroll', ref: node.ref, dy: intent.dy }] }
  }
  if (tier !== 'full' || !TEXT_ROLES.has(role)) return
  if (intent.kind === 'setText' && can.setText) {
    return { actions: [{ type: 'setText', ref: node.ref, text: intent.text }], expect: { kind: 'valueEquals', ref: node.ref, value: intent.text } }
  }
  // Append is keystrokes after the existing text: a click to focus the area
  // (and make its window key), ⌘↓ to the end of the document — the Cocoa
  // text system's moveToEndOfDocument:, which a posted End key is not — then
  // the text. No `expect`: the app may auto-correct what was typed, and
  // valueEquals on the guessed result would time out on a success.
  if (intent.kind === 'append' && can.typeText && node.bounds && node.bounds.width > 0 && node.bounds.height > 0) {
    return { actions: [{ type: 'click', ref: node.ref }, { type: 'keypress', keys: ['cmd+down'] }, { type: 'typeText', text: intent.text }] }
  }
  if (intent.kind === 'enter' && node.appFocused && (can.setText || can.typeText)) {
    return { actions: [{ type: 'keypress', keys: ['Return'] }] }
  }
}
