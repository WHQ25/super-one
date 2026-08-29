import { useEffect } from 'react'
import { useChatStore, useActiveSession, lastTouchedPane, type SessionScope } from '@/stores/chat'

/**
 * The pane an event happened in.
 *
 * These handlers are bound to `window`, so they sit outside every
 * `SessionScopeProvider` and cannot use `useSessionScope`. Without an answer
 * here, pressing Shift+Tab while working in a side chat toggles the *main*
 * conversation's plan mode, silently and invisibly.
 *
 * Two sources, in order. The DOM attributes `SessionPane` mirrors are exact, but
 * only reachable while the event target is inside the pane's subtree — a Radix
 * popover, dropdown or dialog portals its content to `document.body`, so an
 * element the user sees inside the side chat is a DOM sibling of the whole app.
 * The pane's own record of being touched covers that case, because the click
 * that opened the portal landed inside the pane first.
 */
function scopeFromEvent(e: Event): SessionScope | undefined {
  const el = (e.target as Element | null)?.closest?.('[data-scope-session]')
  if (el instanceof HTMLElement) {
    const { scopeProject, scopeSession } = el.dataset
    if (scopeProject && scopeSession) return { projectPath: scopeProject, sessionId: scopeSession }
  }
  const remembered = lastTouchedPane()
  if (!remembered) return undefined
  // The remembered pane can outlive its session — closing a side chat, or
  // removing a mosaic tile, disposes the runtime while the last thing the user
  // touched is still that pane. Targeting it then would address a session that
  // no longer exists, and the per-session writers create a row for an unknown id
  // rather than refuse it, resurrecting the closed chat as a phantom.
  const project = useChatStore.getState().projectSessions[remembered.projectPath]
  return project?._sessions[remembered.sessionId] ? remembered : undefined
}

export function useChatKeyboardShortcuts(enabled = true) {
  const togglePlanModeShortcut = useChatStore((s) => s.togglePlanModeShortcut)
  const pendingPlanApproval = useActiveSession((s) => s.pendingPlanApproval)
  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent): void => {
      if (pendingPlanApproval) return
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault()
        togglePlanModeShortcut(scopeFromEvent(e))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled, togglePlanModeShortcut, pendingPlanApproval])

  // Ctrl+T (⌃T) toggles todo list popup. Kept Ctrl-only so Cmd+T (⌘T) stays
  // reserved for opening a browser tab in the activity panel.
  const toggleTodos = useChatStore((s) => s.toggleTodos)
  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 't' && e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        toggleTodos()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled, toggleTodos])

  // Cmd/Ctrl+N creates a new session
  const resetSession = useChatStore((s) => s.resetSession)
  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'n' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        resetSession()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled, resetSession])

  // Seed the per-project session list so the Ctrl+Tab session switcher has data.
  const activeProject = useChatStore((s) => s.activeProject)
  const fetchSessions = useChatStore((s) => s.fetchSessions)
  useEffect(() => {
    if (!enabled) return
    if (!activeProject) return
    fetchSessions()
  }, [enabled, activeProject, fetchSessions])
}
