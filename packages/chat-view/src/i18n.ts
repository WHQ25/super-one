import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources } from '@superone/shared/i18n'
import type { Locale } from '@superone/shared/agent-types'

export async function initializeChatViewI18n(locale: Locale = 'en'): Promise<void> {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources,
      lng: locale,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      returnNull: false,
    })
    return
  }
  if (i18n.language !== locale) await i18n.changeLanguage(locale)
}

export async function setChatViewLocale(locale: Locale): Promise<void> {
  await initializeChatViewI18n(locale)
}
