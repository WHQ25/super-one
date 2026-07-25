import { useEffect } from 'react'
import { useChatStore, useActiveSession } from '@/stores/chat'

export function useChatKeyboardShortcuts(enabled = true) {
  const togglePlanModeShortcut = useChatStore((s) => s.togglePlanModeShortcut)
  const pendingPlanApproval = useActiveSession((s) => s.pendingPlanApproval)
  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent): void => {
      if (pendingPlanApproval) return
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault()
        togglePlanModeShortcut()
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
