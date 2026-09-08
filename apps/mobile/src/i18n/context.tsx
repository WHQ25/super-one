import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Locale } from '@superone/shared/agent-types'
import type { Kv } from '@superone/relay-client'
import { loadLocale, saveLocale, systemLocale } from '../mobile-preferences'
import { translateMobileText } from './messages'

type MobileLocaleContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (source: string) => string
}

const MobileLocaleContext = createContext<MobileLocaleContextValue | null>(null)

export function MobileLocaleProvider(props: {
  children: ReactNode
  store?: Pick<Kv, 'get' | 'set'> | null
  initialLocale?: Locale
}) {
  const [locale, setLocaleState] = useState<Locale>(() => props.initialLocale ?? systemLocale())
  const changed = useRef(false)
  useEffect(() => {
    if (props.initialLocale) {
      setLocaleState(props.initialLocale)
      return
    }
    let active = true
    void loadLocale(props.store).then((stored) => {
      if (active && !changed.current) setLocaleState(stored)
    }).catch(() => {})
    return () => { active = false }
  }, [props.initialLocale, props.store])
  const setLocale = useCallback((next: Locale) => {
    changed.current = true
    setLocaleState(next)
    void saveLocale(props.store, next).catch(() => {})
  }, [props.store])
  const value = useMemo<MobileLocaleContextValue>(() => ({
    locale,
    setLocale,
    t: (source) => translateMobileText(locale, source),
  }), [locale, setLocale])
  return <MobileLocaleContext.Provider value={value}>{props.children}</MobileLocaleContext.Provider>
}

export function useMobileLocale(): MobileLocaleContextValue {
  const value = useContext(MobileLocaleContext)
  if (!value) throw new Error('useMobileLocale must be used within MobileLocaleProvider')
  return value
}
