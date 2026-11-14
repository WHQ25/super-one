import { createContext, useContext, useEffect, useState } from 'react'

/** A mod theme pane's scheme. Null follows the document. */
export const PaneColorSchemeContext = createContext<'light' | 'dark' | null>(null)

function useDocumentDark(): boolean {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return isDark
}

/** Document appearance, unless this tree is inside a mod theme pane. */
export function useIsDark(): boolean {
  const pane = useContext(PaneColorSchemeContext)
  const documentDark = useDocumentDark()
  if (pane) return pane === 'dark'
  return documentDark
}
