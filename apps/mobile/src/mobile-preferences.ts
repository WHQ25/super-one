import type { Locale, ThemeMode } from '@superone/shared/agent-types'
import { resolveSystemLocale } from '@superone/shared/i18n'
import type { Kv } from '@superone/relay-client'

export const MOBILE_THEME_MODE_KEY = 'mobile.themeMode'
export const MOBILE_LOCALE_KEY = 'mobile.locale'
export const MOBILE_UPDATE_DISMISSED_BUILD_KEY = 'mobile.update.dismissedBuild'
export const MOBILE_UPDATE_LAST_CHECKED_KEY = 'mobile.update.lastCheckedAt'

const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark']

/** Ships dark; `system` stays available but is an explicit opt-in from settings. */
export const DEFAULT_THEME_MODE: ThemeMode = 'dark'
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
  return THEME_MODES.includes(stored as ThemeMode) ? stored as ThemeMode : DEFAULT_THEME_MODE
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

/** Parse a persisted counter, treating anything unreadable as "never". */
function storedInteger(raw: string | null | undefined): number | null {
  if (!raw) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

/**
 * The newest build the user has said "later" to.
 *
 * Stored as the build code rather than a boolean so the next release asks
 * again on its own -- a sticky "don't ask" flag would silently strand people.
 */
export async function loadDismissedUpdateBuild(
  store: Pick<Kv, 'get'> | null | undefined,
): Promise<number | null> {
  return storedInteger(await store?.get(MOBILE_UPDATE_DISMISSED_BUILD_KEY))
}

export async function saveDismissedUpdateBuild(
  store: Pick<Kv, 'set'> | null | undefined,
  buildCode: number,
): Promise<void> {
  await store?.set(MOBILE_UPDATE_DISMISSED_BUILD_KEY, String(buildCode))
}

export async function loadLastUpdateCheckAt(
  store: Pick<Kv, 'get'> | null | undefined,
): Promise<number | null> {
  return storedInteger(await store?.get(MOBILE_UPDATE_LAST_CHECKED_KEY))
}

export async function saveLastUpdateCheckAt(
  store: Pick<Kv, 'set'> | null | undefined,
  atMs: number,
): Promise<void> {
  await store?.set(MOBILE_UPDATE_LAST_CHECKED_KEY, String(Math.floor(atMs)))
}
