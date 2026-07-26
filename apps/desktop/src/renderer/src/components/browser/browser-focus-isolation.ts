/**
 * Keep agent browser automation from stealing the user's host focus.
 *
 * Background: CDP/synthetic ops may focus a <webview> guest (or an element
 * inside it), which moves keyboard focus out of the chat composer. Multi-session
 * runs make this worse — a background session can blur the session the user is
 * typing in.
 *
 * Strategy:
 * 1. Snapshot the user's non-browser activeElement when automation starts.
 * 2. While isolation is active, bounce any focus that lands on a browser host
 *    webview back to that snapshot (capture-phase focusin).
 * 3. On end, restore again (covers steals that skipped focusin).
 *
 * Nested / concurrent automation calls are ref-counted so isolation stays up
 * for the whole stack.
 */

function isBrowserHostTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.tagName === 'WEBVIEW') return true
  return target.closest('[data-browser-host]') != null
}

let depth = 0
let saved: HTMLElement | null = null
let savedSelection: { start: number; end: number } | null = null

function snapshotUserFocus(): void {
  const el = document.activeElement
  if (!(el instanceof HTMLElement) || isBrowserHostTarget(el)) {
    saved = null
    savedSelection = null
    return
  }
  saved = el
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    try {
      savedSelection = { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 }
    } catch {
      savedSelection = null
    }
  } else {
    savedSelection = null
  }
}

function restoreUserFocus(): void {
  if (!saved || !document.contains(saved)) return
  if (document.activeElement === saved) return
  try {
    saved.focus({ preventScroll: true })
    if (
      savedSelection &&
      (saved instanceof HTMLInputElement || saved instanceof HTMLTextAreaElement)
    ) {
      try {
        saved.setSelectionRange(savedSelection.start, savedSelection.end)
      } catch {
        // Some input types reject setSelectionRange.
      }
    }
  } catch {
    // Element may no longer be focusable.
  }
}

function onFocusIn(event: FocusEvent): void {
  if (!isBrowserHostTarget(event.target)) return
  // User was outside the browser — never let automation hold webview focus.
  if (saved && document.contains(saved)) {
    restoreUserFocus()
  }
}

/** True when at least one automation call is inside the isolation region. */
export function isBrowserFocusIsolationActive(): boolean {
  return depth > 0
}

export function beginBrowserFocusIsolation(): void {
  if (depth === 0) {
    snapshotUserFocus()
    document.addEventListener('focusin', onFocusIn, true)
  }
  depth += 1
}

export function endBrowserFocusIsolation(): void {
  if (depth === 0) return
  depth -= 1
  if (depth > 0) return
  document.removeEventListener('focusin', onFocusIn, true)
  restoreUserFocus()
  saved = null
  savedSelection = null
}

export async function withBrowserFocusIsolation<T>(fn: () => Promise<T>): Promise<T> {
  beginBrowserFocusIsolation()
  try {
    return await fn()
  } finally {
    endBrowserFocusIsolation()
  }
}

/** Test-only: reset refcount and listeners between cases. */
export function _resetBrowserFocusIsolationForTests(): void {
  if (depth > 0) {
    document.removeEventListener('focusin', onFocusIn, true)
  }
  depth = 0
  saved = null
  savedSelection = null
}
