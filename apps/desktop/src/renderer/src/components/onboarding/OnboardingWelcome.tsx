import { useEffect, useState } from 'react'
import { ArrowRight, Check, Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { useAppStore } from '@/stores/app'
import { changeLocale } from '@/i18n'
import { resolveSystemLocale } from '@superone/shared/i18n'
import type { Locale } from '@superone/shared/agent-types'

const LOCALE_LABEL: Record<Locale, string> = { en: 'English', zh: '简体中文' }

export function OnboardingWelcome(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const goToOnboardingStep = useAppStore((s) => s.goToOnboardingStep)
  const [busy, setBusy] = useState(false)
  const currentLocale: Locale = i18n.language === 'zh' ? 'zh' : 'en'

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [settings, system] = await Promise.all([
        window.app.getAppSettings(),
        window.app.getSystemLocale(),
      ])
      if (cancelled) return
      if (settings.locale) return
      const detected = resolveSystemLocale(system)
      if (detected !== i18n.language) await changeLocale(detected)
    })()
    return () => {
      cancelled = true
    }
  }, [i18n.language])

  const pickLocale = async (locale: Locale) => {
    if (busy || locale === currentLocale) return
    setBusy(true)
    try {
      await changeLocale(locale)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-10">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-bold tracking-tight">{t('shell.onboarding.welcome.title')}</h1>
        <p className="mt-4 text-base text-muted-foreground">{t('shell.onboarding.welcome.tagline')}</p>
      </div>

      <div className="flex flex-col items-center gap-4">
        <Button size="lg" onClick={() => goToOnboardingStep('discover')}>
          {t('common.continue')}
          <ArrowRight className="size-5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <Languages className="size-3.5" />
              {LOCALE_LABEL[currentLocale]}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            {(Object.keys(LOCALE_LABEL) as Locale[]).map((locale) => (
              <DropdownMenuItem
                key={locale}
                onClick={() => {
                  void pickLocale(locale)
                }}
                className="flex items-center justify-between gap-4"
              >
                <span>{LOCALE_LABEL[locale]}</span>
                {currentLocale === locale && <Check className="size-4 text-muted-foreground" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
