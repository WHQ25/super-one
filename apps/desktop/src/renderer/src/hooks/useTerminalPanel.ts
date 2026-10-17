import { useCallback } from 'react'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { projectSessionKey } from '@superone/shared/remote-resource-key'
import { NO_SESSION_KEY, useTerminalStore } from '@/stores/terminal'

export function useTerminalPanel(): {
  sessionId: string | null
  open: boolean
  toggle: () => void
  setOpen: (open: boolean) => void
} {
  const sessionId = useActiveSession((s) => s._activeSessionId) as string | null
  const projectPath = useChatStore((s) => s.activeProject)
  const key = sessionId ? projectSessionKey(projectPath, sessionId) : null
  const open = useTerminalStore((s) => s.openBySession[key ?? NO_SESSION_KEY] ?? false)
  const toggleOpen = useTerminalStore((s) => s.toggleOpen)
  const setOpenRaw = useTerminalStore((s) => s.setOpen)

  const toggle = useCallback(() => toggleOpen(key), [toggleOpen, key])
  const setOpen = useCallback((v: boolean) => setOpenRaw(key, v), [setOpenRaw, key])

  return { sessionId, open, toggle, setOpen }
}
