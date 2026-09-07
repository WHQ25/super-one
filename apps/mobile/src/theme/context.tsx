import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import type { HarnessId } from '@superone/shared/agent-types'
import { createMobileStyles } from './styles'
import { MenuHost } from '../ui/menu-host'
import { mobileThemeTokens, normalizeColorScheme, type MobileThemeTokens, type MobileColorScheme } from './tokens'

interface MobileThemeContextValue {
  tokens: MobileThemeTokens
  setHarness: (harness: HarnessId) => void
  /**
   * The hue the connected host uses for this harness. Kept per harness because
   * the desktop stores one per harness and a session can switch between them;
   * `null` restores the built-in default.
   */
  setBrandHue: (harness: HarnessId, hue: number | null) => void
}

const MobileThemeContext = createContext<MobileThemeContextValue | null>(null)

export function MobileThemeProvider({ children, colorScheme }: { children: ReactNode; colorScheme?: MobileColorScheme }) {
  const systemScheme = useColorScheme()
  const scheme = colorScheme ?? normalizeColorScheme(systemScheme)
  const [harness, setHarness] = useState<HarnessId>('claude')
  const [hostHues, setHostHues] = useState<Partial<Record<HarnessId, number | null>>>({})
  const setBrandHue = useCallback((target: HarnessId, hue: number | null) => {
    setHostHues((current) => current[target] === hue ? current : { ...current, [target]: hue })
  }, [])
  const tokens = useMemo(
    () => mobileThemeTokens(scheme, harness, hostHues[harness]),
    [harness, scheme, hostHues],
  )
  const value = useMemo(() => ({ tokens, setHarness, setBrandHue }), [tokens, setBrandHue])
  return <MobileThemeContext.Provider value={value}><MenuHost>{children}</MenuHost></MobileThemeContext.Provider>
}

export function useMobileTheme(): MobileThemeContextValue {
  const value = useContext(MobileThemeContext)
  if (!value) throw new Error('useMobileTheme must be used within MobileThemeProvider')
  return value
}

export function useMobileStyles() {
  const { tokens } = useMobileTheme()
  return useMemo(() => createMobileStyles(tokens), [tokens])
}
