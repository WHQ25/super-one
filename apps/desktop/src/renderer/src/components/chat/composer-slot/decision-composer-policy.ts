interface DecisionKeyboardPolicy {
  requestKey: string
  guardUntil: number
}

const keyboardPolicies = new WeakMap<HTMLElement, DecisionKeyboardPolicy>()
const recentInputFocus = new WeakMap<HTMLElement, number>()
/** Surfaces that do not rise in the composer slot (plan approval, app input, continuation). */
const SHORTCUT_GUARD_MS = 500
/**
 * A rise that never finishes (hidden window) must not hold Enter forever.
 * Matches ComposerSwitch's stuck-animation deadline.
 */
const ENTRANCE_GUARD_FALLBACK_MS = 600
const RECENT_INPUT_FOCUS_MS = 1_000

/**
 * Hold Enter, Space and digit shortcuts for one decision.
 *
 * Pass the composer stage (`data-composer-stage`) to hold them only while that
 * stage is entering. A stage already at rest, or `null`, does not hold them.
 * Omit the stage for the fixed window used by prompts that do not use the rise.
 */
export function setDecisionKeyboardPolicy(
  root: HTMLElement,
  requestKey: string,
  entrance?: HTMLElement | null,
): () => void {
  const rising = !!entrance && entrance.getAttribute('data-phase') === 'entering'
  const policy: DecisionKeyboardPolicy = {
    requestKey,
    guardUntil: entrance === undefined
      ? Date.now() + SHORTCUT_GUARD_MS
      : rising ? Date.now() + ENTRANCE_GUARD_FALLBACK_MS : 0,
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
  const release = () => { policy.guardUntil = 0 }
  const onEntranceDone = (event: Event) => {
    if (event.target !== entrance) return
    release()
  }
  if (rising && entrance) {
    entrance.addEventListener('animationend', onEntranceDone)
    entrance.addEventListener('webkitAnimationEnd', onEntranceDone)
    entrance.addEventListener('animationcancel', onEntranceDone)
  }
  return () => {
    if (rising && entrance) {
      entrance.removeEventListener('animationend', onEntranceDone)
      entrance.removeEventListener('webkitAnimationEnd', onEntranceDone)
      entrance.removeEventListener('animationcancel', onEntranceDone)
    }
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
  // Composer newline shortcuts edit text even while the card is rising.
  if (textarea && event.key === 'Enter' && (event.shiftKey || event.altKey)) return false
  return isDecisionShortcut(event) && Date.now() < policy.guardUntil
}

function isDecisionShortcut(event: KeyboardEvent): boolean {
  return event.key === 'Enter' || event.key === ' ' || /^[1-9]$/.test(event.key)
}

/**
 * Decision keys are scoped to the chat pane that holds focus, so focus that falls to
 * <body> leaves every shortcut dead. A prompt container marked `data-decision-focus`
 * (with `tabIndex={-1}`) is where focus rests when no control inside should have it.
 *
 * On mount: the editor this prompt replaced has unmounted and taken focus with it.
 * Take it back unless the person is working in another surface or the prompt
 * already focused one of its own controls.
 */
export function claimDecisionFocus(container: HTMLElement | null, root: HTMLElement | null | undefined): void {
  const active = document.activeElement
  if (!container || container.contains(active)) return
  if (!active || active === document.body || root?.contains(active)) container.focus({ preventScroll: true })
}

/** Leaves a prompt's text field (Escape, Tab) without dropping focus out of the prompt. */
export function leaveDecisionField(field: HTMLElement | null): void {
  field?.closest<HTMLElement>('[data-decision-focus]')?.focus({ preventScroll: true })
}

export function noteChatInputFocused(root: HTMLElement): void {
  recentInputFocus.set(root, Date.now())
}

export function wasChatInputFocusedRecently(root: HTMLElement | null | undefined): boolean {
  if (!root) return false
  const focusedAt = recentInputFocus.get(root)
  return focusedAt !== undefined && Date.now() - focusedAt <= RECENT_INPUT_FOCUS_MS
}
