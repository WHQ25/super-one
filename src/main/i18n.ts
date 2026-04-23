import i18next from 'i18next'
import { app, BrowserWindow } from 'electron'
import { AgentIpcChannels, type Locale } from '../shared/agent-types'
import { resolveSystemLocale, resources } from '../shared/i18n'
import { readAppSettings } from './app-settings-service'

let currentLocale: Locale = 'en'

export function getSystemLocale(): string {
  try {
    return app.getLocale()
  } catch {
    return ''
  }
}

export async function initMainI18n(): Promise<void> {
  const settings = readAppSettings()
  currentLocale = settings.locale || resolveSystemLocale(getSystemLocale())
  await i18next.init({
    resources,
    lng: currentLocale,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  })
}

export async function applyLocale(locale: Locale): Promise<void> {
  if (currentLocale === locale) return
  currentLocale = locale
  await i18next.changeLanguage(locale)
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(AgentIpcChannels.APP_LOCALE_CHANGED, locale)
  }
}

export function getCurrentLocale(): Locale {
  return currentLocale
}

export function t(key: string, options?: Record<string, unknown>): string {
  return i18next.t(key, options) as string
}
