import { useState, useEffect } from 'react'
import type { ThemeMode } from '@superone/shared/agent-types'

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>('system')
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  useEffect(() => {
    let cancelled = false
    void window.app.getTheme().then((state) => {
      if (cancelled) return
      setModeState(state.mode)
      setDark(state.dark)
    }).catch(() => {})
    const cleanup = window.app.onThemeChange((state) => {
      setModeState(state.mode)
      setDark(state.dark)
    })
    return () => { cancelled = true; cleanup() }
  }, [])

  const setMode = (next: ThemeMode): void => {
    setModeState(next)
    void window.app.setTheme(next).catch(() => {})
  }

  return { mode, dark, setMode }
}
