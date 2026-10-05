import type { PermissionRequest } from '@superone/shared/agent-types'

interface DecisionKeyboardPolicy {
  requestKey: string
  guardUntil: number
  requireExplicitApproval: boolean
}

const keyboardPolicies = new WeakMap<HTMLElement, DecisionKeyboardPolicy>()
const recentInputFocus = new WeakMap<HTMLElement, number>()
const SHORTCUT_GUARD_MS = 500
const RECENT_INPUT_FOCUS_MS = 1_000

export function isHighRiskPermission(request: PermissionRequest | undefined): boolean {
  if (!request) return false
  if (request.defaultToNo || request.requestKind === 'terminal_command_confirm') return true
  return /(?:^|[._-])(?:bash|shell|terminal)(?:$|[._-])/i.test(request.toolName)
}

export function setDecisionKeyboardPolicy(
  root: HTMLElement,
  requestKey: string,
  requireExplicitApproval: boolean,
): () => void {
  const policy = {
    requestKey,
    guardUntil: Date.now() + SHORTCUT_GUARD_MS,
    requireExplicitApproval,
  }
  keyboardPolicies.set(root, policy)
  const guardNativeActivation = (event: KeyboardEvent) => {
    if (!shouldSuppressDecisionShortcut(event, root)) return
    // Returning from a window listener does not cancel a button's native click.
    // Keep text fields editable, but prevent Enter/Space from activating a button.
    if (event.target instanceof Element && (
      ((event.key === 'Enter' || event.key === ' ') && event.target.closest('button'))
      || (event.key === 'Enter' && event.target instanceof HTMLTextAreaElement)
    )) event.preventDefault()
    event.stopPropagation()
  }
  root.addEventListener('keydown', guardNativeActivation, true)
  return () => {
    root.removeEventListener('keydown', guardNativeActivation, true)
    if (keyboardPolicies.get(root) === policy) keyboardPolicies.delete(root)
  }
}

export function shouldSuppressDecisionShortcut(event: KeyboardEvent, root: HTMLElement | null | undefined): boolean {
  if (!root) return false
  const policy = keyboardPolicies.get(root)
  if (!policy) return false
  const textarea = event.target instanceof HTMLTextAreaElement ? event.target : null
  if (textarea && event.isComposing) return false
  // Composer newline shortcuts edit text even during the accidental-submit guard.
  if (textarea && event.key === 'Enter' && (event.shiftKey || event.altKey)) return false
  if (isDecisionShortcut(event) && Date.now() < policy.guardUntil) return true
  // Enter in a feedback field rejects; it must never become a high-risk approval.
  if (textarea?.hasAttribute('data-feedback') && event.key === 'Enter') return false
  if (!policy.requireExplicitApproval) return false
  if (event.key === 'Tab' && event.shiftKey) return true
  return isDecisionShortcut(event) && !(event.key === 'Enter' && event.metaKey)
}

function isDecisionShortcut(event: KeyboardEvent): boolean {
  return event.key === 'Enter' || event.key === ' ' || /^[1-9]$/.test(event.key)
}

export function noteChatInputFocused(root: HTMLElement): void {
  recentInputFocus.set(root, Date.now())
}

export function wasChatInputFocusedRecently(root: HTMLElement | null | undefined): boolean {
  if (!root) return false
  const focusedAt = recentInputFocus.get(root)
  return focusedAt !== undefined && Date.now() - focusedAt <= RECENT_INPUT_FOCUS_MS
}
