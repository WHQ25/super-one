import { createContext, useContext } from 'react'

export interface SessionScope {
  projectPath: string
  sessionId: string
}

const SessionScopeContext = createContext<SessionScope | null>(null)

export const SessionScopeProvider = SessionScopeContext.Provider

export function useSessionScope(): SessionScope | null {
  return useContext(SessionScopeContext)
}

/**
 * The pane the user last interacted with, for handlers that cannot read the
 * React context.
 *
 * Window-level keyboard shortcuts sit outside every `SessionScopeProvider`, so
 * they identify the pane from the DOM instead. That works while focus is inside
 * the pane's subtree, and fails the moment a Radix popover, dropdown or dialog
 * portals its content to `document.body` — an element that is visually inside
 * the side chat but a DOM sibling of the whole app.
 *
 * Panes therefore record themselves on pointer-down and focus, both of which
 * happen on the trigger *inside* the pane before any portal opens. `null` is a
 * real value: it means the last pane touched was the unscoped main chat.
 */
let lastTouchedPaneScope: SessionScope | null = null

export function markPaneTouched(scope: SessionScope | null): void {
  lastTouchedPaneScope = scope
}

export function lastTouchedPane(): SessionScope | null {
  return lastTouchedPaneScope
}

/** @internal test-only — resets the module-level pane memory between cases. */
export function _resetLastTouchedPane(): void {
  lastTouchedPaneScope = null
}
