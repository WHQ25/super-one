import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import type { HarnessId } from '@superone/shared/agent-types'
import { createMobileStyles } from './styles'
import { mobileThemeTokens, normalizeColorScheme, type MobileThemeTokens } from './tokens'

interface MobileThemeContextValue {
  tokens: MobileThemeTokens
  setHarness: (harness: HarnessId) => void
}

const MobileThemeContext = createContext<MobileThemeContextValue | null>(null)

export function MobileThemeProvider({ children }: { children: ReactNode }) {
  const scheme = normalizeColorScheme(useColorScheme())
  const [harness, setHarness] = useState<HarnessId>('claude')
  const tokens = useMemo(() => mobileThemeTokens(scheme, harness), [harness, scheme])
  const value = useMemo(() => ({ tokens, setHarness }), [tokens])
  return <MobileThemeContext.Provider value={value}>{children}</MobileThemeContext.Provider>
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
