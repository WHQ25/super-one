import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import type { HarnessId, Locale, ThemeMode } from '@superone/shared/agent-types'
import type { Kv } from '@superone/relay-client'
import { createMobileStyles } from './styles'
import { MenuHost } from '../ui/menu-host'
import { mobileThemeTokens, normalizeColorScheme, type MobileThemeTokens, type MobileColorScheme } from './tokens'
import { loadThemeMode, saveThemeMode } from '../mobile-preferences'
import { MobileLocaleProvider } from '../i18n/context'

interface MobileThemeContextValue {
  tokens: MobileThemeTokens
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  setHarness: (harness: HarnessId) => void
  /**
   * The hue the connected host uses for this harness. Kept per harness because
   * the desktop stores one per harness and a session can switch between them;
   * `null` restores the built-in default.
   */
  setBrandHue: (harness: HarnessId, hue: number | null) => void
}

const MobileThemeContext = createContext<MobileThemeContextValue | null>(null)

export function MobileThemeProvider({ children, colorScheme, store, locale }: {
  children: ReactNode
  colorScheme?: MobileColorScheme
  store?: Pick<Kv, 'get' | 'set'> | null
  /** Deterministic initial locale for previews and component tests. */
  locale?: Locale
}) {
  const systemScheme = useColorScheme()
  const [mode, setModeState] = useState<ThemeMode>(colorScheme ?? 'system')
  const changed = useRef(false)
  useEffect(() => {
    if (colorScheme) { setModeState(colorScheme); return }
    let active = true
    void loadThemeMode(store).then((stored) => {
      if (active && !changed.current) setModeState(stored)
    }).catch(() => {})
    return () => { active = false }
  }, [colorScheme, store])
  const setMode = useCallback((next: ThemeMode) => {
    changed.current = true
    setModeState(next)
    void saveThemeMode(store, next).catch(() => {})
  }, [store])
  const scheme = colorScheme ?? (mode === 'system' ? normalizeColorScheme(systemScheme) : mode)
  const [harness, setHarness] = useState<HarnessId>('claude')
  const [hostHues, setHostHues] = useState<Partial<Record<HarnessId, number | null>>>({})
  const setBrandHue = useCallback((target: HarnessId, hue: number | null) => {
    setHostHues((current) => current[target] === hue ? current : { ...current, [target]: hue })
  }, [])
  const tokens = useMemo(
    () => mobileThemeTokens(scheme, harness, hostHues[harness]),
    [harness, scheme, hostHues],
  )
  const value = useMemo(() => ({ tokens, mode, setMode, setHarness, setBrandHue }), [tokens, mode, setMode, setBrandHue])
  return <MobileLocaleProvider store={store} initialLocale={locale}>
    <MobileThemeContext.Provider value={value}><MenuHost>{children}</MenuHost></MobileThemeContext.Provider>
  </MobileLocaleProvider>
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
