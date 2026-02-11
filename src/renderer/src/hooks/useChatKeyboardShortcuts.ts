import { useEffect } from 'react'
import { useChatStore } from '@/stores/chat'

export function useChatKeyboardShortcuts() {
  // Shift+Tab cycles permission mode
  const cyclePermissionMode = useChatStore((s) => s.cyclePermissionMode)
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault()
        cyclePermissionMode()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [cyclePermissionMode])

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
