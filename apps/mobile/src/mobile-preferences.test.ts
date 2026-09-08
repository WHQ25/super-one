import { describe, expect, it } from 'vitest'
import {
  MOBILE_LOCALE_KEY,
  MOBILE_THEME_MODE_KEY,
  loadLocale,
  loadThemeMode,
  saveLocale,
  saveThemeMode,
} from './mobile-preferences'

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => { values.set(key, value) },
  }
}

describe('mobile preferences', () => {
  it('loads valid persisted values', async () => {
    const store = memoryStore({ [MOBILE_THEME_MODE_KEY]: 'dark', [MOBILE_LOCALE_KEY]: 'zh' })

    await expect(loadThemeMode(store)).resolves.toBe('dark')
    await expect(loadLocale(store, 'en')).resolves.toBe('zh')
  })

  it('falls back when persisted values are unknown', async () => {
    const store = memoryStore({ [MOBILE_THEME_MODE_KEY]: 'sepia', [MOBILE_LOCALE_KEY]: 'fr' })

    await expect(loadThemeMode(store)).resolves.toBe('system')
    await expect(loadLocale(store, 'en')).resolves.toBe('en')
  })

  it('persists theme and language choices', async () => {
    const store = memoryStore()

    await saveThemeMode(store, 'light')
    await saveLocale(store, 'zh')

    expect(store.values.get(MOBILE_THEME_MODE_KEY)).toBe('light')
    expect(store.values.get(MOBILE_LOCALE_KEY)).toBe('zh')
  })
})
