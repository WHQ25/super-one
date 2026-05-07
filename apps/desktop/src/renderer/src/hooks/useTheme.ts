import { useState, useEffect } from 'react'

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  useEffect(() => {
    let cancelled = false
    void window.app.getTheme().then((next) => { if (!cancelled) setDark(next) }).catch(() => {})
    const cleanup = window.app.onThemeChange((next) => setDark(next))
    return () => { cancelled = true; cleanup() }
  }, [])

  const toggle = (): void => {
    setDark((prev) => {
      const next = !prev
      void window.app.setTheme(next).catch(() => {})
      return next
    })
  }

  return { dark, toggle }
}
