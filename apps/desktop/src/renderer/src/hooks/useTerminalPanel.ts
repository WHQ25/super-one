import { useCallback } from 'react'
import { useActiveSession } from '@/stores/chat'
import { NO_SESSION_KEY, useTerminalStore } from '@/stores/terminal'

export function useTerminalPanel(): {
  sessionId: string | null
  open: boolean
  toggle: () => void
  setOpen: (open: boolean) => void
} {
  const sessionId = useActiveSession((s) => s._activeSessionId) as string | null
  const open = useTerminalStore((s) => s.openBySession[sessionId ?? NO_SESSION_KEY] ?? false)
  const toggleOpen = useTerminalStore((s) => s.toggleOpen)
  const setOpenRaw = useTerminalStore((s) => s.setOpen)

  const toggle = useCallback(() => toggleOpen(sessionId), [toggleOpen, sessionId])
  const setOpen = useCallback((v: boolean) => setOpenRaw(sessionId, v), [setOpenRaw, sessionId])

  return { sessionId, open, toggle, setOpen }
}
