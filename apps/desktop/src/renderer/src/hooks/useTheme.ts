import { useState, useEffect, useSyncExternalStore } from 'react'
import type { ThemeMode } from '@superone/shared/agent-types'
import { dismissHarnessScheme, harnessSchemeHold, subscribeHarnessScheme } from '@/components/chat/mod/mod-harness-scheme'

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>('system')
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const hold = useSyncExternalStore(subscribeHarnessScheme, harnessSchemeHold, () => null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', hold ? hold === 'dark' : dark)
  }, [dark, hold])

  useEffect(() => {
    let cancelled = false
    let receivedChange = false
    void window.app.getTheme().then((state) => {
      if (cancelled || receivedChange) return
      setModeState(state.mode)
      setDark(state.dark)
    }).catch(() => {})
    const cleanup = window.app.onThemeChange((state) => {
      receivedChange = true
      // An appearance change wins over a mod theme's hold.
      dismissHarnessScheme()
      setModeState(state.mode)
      setDark(state.dark)
    })
    return () => { cancelled = true; cleanup() }
  }, [])

  const setMode = (next: ThemeMode): void => {
    dismissHarnessScheme()
    setModeState(next)
    void window.app.setTheme(next).catch(() => {})
  }

  return { mode, dark, setMode }
}
