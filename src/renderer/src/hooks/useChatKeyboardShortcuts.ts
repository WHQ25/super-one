import { useEffect } from 'react'
import { useChatStore, useActiveSession } from '@/stores/chat'

export function useChatKeyboardShortcuts() {
  const togglePlanModeShortcut = useChatStore((s) => s.togglePlanModeShortcut)
  const pendingPlanApproval = useActiveSession((s) => s.pendingPlanApproval)
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (pendingPlanApproval) return
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault()
        togglePlanModeShortcut()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [togglePlanModeShortcut, pendingPlanApproval])

  // Ctrl+T toggles todo list popup
  const toggleTodos = useChatStore((s) => s.toggleTodos)
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 't' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        toggleTodos()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleTodos])

  // Cmd/Ctrl+N creates a new session
  const resetSession = useChatStore((s) => s.resetSession)
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'n' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        resetSession()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [resetSession])
}
