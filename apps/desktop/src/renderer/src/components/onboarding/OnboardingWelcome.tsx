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
import { useTheme } from '@/hooks/useTheme'
import { ThemeModeCards } from '@/components/settings/ThemeModeCards'
import { changeLocale } from '@/i18n'
import { applyCrispText } from '@/lib/font-smoothing'
import { resolveSystemLocale } from '@superone/shared/i18n'
import type { Locale } from '@superone/shared/agent-types'

const LOCALE_LABEL: Record<Locale, string> = { en: 'English', zh: '简体中文' }

export function OnboardingWelcome(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const goToOnboardingStep = useAppStore((s) => s.goToOnboardingStep)
  const setLiquidGlass = useAppStore((s) => s.setLiquidGlass)
  const { mode: themeMode, setMode: setThemeMode } = useTheme()
  const [busy, setBusy] = useState(false)
  const currentLocale: Locale = i18n.language === 'zh' ? 'zh' : 'en'
  const isMac = window.app.platform === 'darwin'
  const supportsLiquidGlass = window.app.supportsLiquidGlass

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [settings, system] = await Promise.all([
        window.app.getAppSettings(),
        window.app.getSystemLocale(),
      ])
      if (cancelled) return

      // Locale: only auto-detect when unset.
      if (!settings.locale) {
        const detected = resolveSystemLocale(system)
        if (detected !== i18n.language) await changeLocale(detected)
      }

      if (supportsLiquidGlass && !settings.liquidGlass) {
        await setLiquidGlass(true)
      }
      // Crisp text is a macOS font-smoothing override.
      if (isMac) {
        if (!settings.crispText) {
          applyCrispText(true)
          await window.app.saveAppSettings({ crispText: true })
        } else {
          applyCrispText(settings.crispText)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [i18n.language, isMac, setLiquidGlass, supportsLiquidGlass])

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
    <div className="flex w-full flex-col items-center gap-10">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-bold tracking-tight">{t('shell.onboarding.welcome.title')}</h1>
      </div>

      <div className="w-full max-w-md">
        <ThemeModeCards
          value={themeMode}
          onChange={setThemeMode}
          labelFor={(mode) => t(`settings.appearance.theme.${mode}`)}
        />
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
