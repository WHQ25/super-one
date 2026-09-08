import type { Locale, ThemeMode } from '@superone/shared/agent-types'
import { resolveSystemLocale } from '@superone/shared/i18n'
import type { Kv } from '@superone/relay-client'

export const MOBILE_THEME_MODE_KEY = 'mobile.themeMode'
export const MOBILE_LOCALE_KEY = 'mobile.locale'

const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark']
const LOCALES: readonly Locale[] = ['en', 'zh']

export function systemLocale(): Locale {
  try {
    return resolveSystemLocale(Intl.DateTimeFormat().resolvedOptions().locale)
  } catch {
    return 'en'
  }
}

export async function loadThemeMode(store: Pick<Kv, 'get'> | null | undefined): Promise<ThemeMode> {
  const stored = await store?.get(MOBILE_THEME_MODE_KEY)
  return THEME_MODES.includes(stored as ThemeMode) ? stored as ThemeMode : 'system'
}

export async function saveThemeMode(store: Pick<Kv, 'set'> | null | undefined, mode: ThemeMode): Promise<void> {
  await store?.set(MOBILE_THEME_MODE_KEY, mode)
}

export async function loadLocale(
  store: Pick<Kv, 'get'> | null | undefined,
  fallback: Locale = systemLocale(),
): Promise<Locale> {
  const stored = await store?.get(MOBILE_LOCALE_KEY)
  return LOCALES.includes(stored as Locale) ? stored as Locale : fallback
}

export async function saveLocale(store: Pick<Kv, 'set'> | null | undefined, locale: Locale): Promise<void> {
  await store?.set(MOBILE_LOCALE_KEY, locale)
}
