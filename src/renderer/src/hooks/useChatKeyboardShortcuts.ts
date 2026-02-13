import { useEffect } from 'react'
import { useChatStore, useActiveSession } from '@/stores/chat'

export function useChatKeyboardShortcuts() {
  // Shift+Tab cycles permission mode
  const cyclePermissionMode = useChatStore((s) => s.cyclePermissionMode)
  const pendingPlanApproval = useActiveSession((s) => s.pendingPlanApproval)
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // Plan review uses Tab for feedback focus; avoid intercepting Shift+Tab here.
      if (pendingPlanApproval) return
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault()
        cyclePermissionMode()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [cyclePermissionMode, pendingPlanApproval])

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
}
