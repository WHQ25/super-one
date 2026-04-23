import type { Locale } from '../agent-types'
import { en, type Messages } from './en'
import { zh } from './zh'

export type { Messages } from './en'

export const resources: Record<Locale, { translation: Messages }> = {
  en: { translation: en },
  zh: { translation: zh },
}

export const supportedLocales: readonly Locale[] = ['en', 'zh']

export function resolveSystemLocale(systemLocale: string | undefined): Locale {
  if (!systemLocale) return 'en'
  return systemLocale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
