import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resolveSystemLocale, resources } from '../../../shared/i18n'
import type { Locale } from '../../../shared/agent-types'

export async function initI18n(): Promise<void> {
  const settings = await window.app.getAppSettings()
  const systemLocale = await window.app.getSystemLocale()
  const initialLocale: Locale = settings.locale || resolveSystemLocale(systemLocale)

  await i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: initialLocale,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      returnNull: false,
    })

  window.app.onLocaleChanged?.((next) => {
    if (i18n.language !== next) void i18n.changeLanguage(next)
  })
}

export async function changeLocale(locale: Locale): Promise<void> {
  await i18n.changeLanguage(locale)
  await window.app.saveAppSettings({ locale })
}

export { default as i18n } from 'i18next'
