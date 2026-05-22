import { useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Switch } from '@superone/ui/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { initAnalytics, shutdownAnalytics } from '@/lib/analytics'
import { applyCrispText } from '@/lib/font-smoothing'
import { processAppIcon } from '@/lib/app-icon-image'
import { changeLocale } from '@/i18n'
import type { Locale } from '@superone/shared/agent-types'

export function AppSettingsPage() {
  const { t, i18n } = useTranslation()
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)
  const [crispText, setCrispText] = useState(true)
  const [customAppIconPath, setCustomAppIconPath] = useState<string | null>(null)
  const [iconDataUri, setIconDataUri] = useState<string | null>(null)
  const [iconBusy, setIconBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savingLocale, setSavingLocale] = useState(false)
  const isMac = window.app.platform === 'darwin'

  useEffect(() => {
    let mounted = true
    window.app.getAppSettings().then((settings) => {
      if (!mounted) return
      setAnalyticsEnabled(settings.analyticsEnabled)
      setCrispText(settings.crispText)
      setCustomAppIconPath(settings.customAppIconPath)
      setLoading(false)
    })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!customAppIconPath) {
      setIconDataUri(null)
      return
    }
    let mounted = true
    window.app.readFileAsDataUri(customAppIconPath).then((result) => {
      if (mounted) setIconDataUri(result.ok ? result.dataUri : null)
    })
    return () => { mounted = false }
  }, [customAppIconPath])

  async function handlePickIcon() {
    if (iconBusy) return
    setIconBusy(true)
    try {
      const filePath = await window.app.pickAppIconFile()
      if (!filePath) return
      const read = await window.app.readFileAsDataUri(filePath)
      if (!read.ok) {
        toast.error(read.error)
        return
      }
      const processed = await processAppIcon(read.dataUri, isMac)
      const result = await window.app.setAppIcon(processed)
      setCustomAppIconPath(result.customAppIconPath)
      toast.success(t('settings.general.appIcon.updated'))
    } finally {
      setIconBusy(false)
    }
  }

  async function handleResetIcon() {
    if (iconBusy) return
    setIconBusy(true)
    try {
      const result = await window.app.resetAppIcon()
      setCustomAppIconPath(result.customAppIconPath)
      toast.success(t('settings.general.appIcon.resetDone'))
    } finally {
      setIconBusy(false)
    }
  }

  async function handleCrispTextToggle(enabled: boolean) {
    applyCrispText(enabled)
    const result = await window.app.saveAppSettings({ crispText: enabled })
    setCrispText(result.crispText)
  }

  async function handleAnalyticsToggle(enabled: boolean) {
    const result = await window.app.saveAppSettings({ analyticsEnabled: enabled })
    setAnalyticsEnabled(result.analyticsEnabled)
    if (result.analyticsEnabled) {
      initAnalytics()
    } else {
      shutdownAnalytics()
    }
    toast.success(t(result.analyticsEnabled ? 'settings.general.analytics.enabled' : 'settings.general.analytics.disabled'))
  }

  async function handleLocaleSelect(locale: Locale) {
    if (savingLocale || i18n.language === locale) return
    setSavingLocale(true)
    try {
      await changeLocale(locale)
      toast.success(i18n.t('settings.general.language.updated', { lng: locale }))
    } finally {
      setSavingLocale(false)
    }
  }

  const currentLocale: Locale = i18n.language === 'zh' ? 'zh' : 'en'
  const languageLabel = currentLocale === 'zh'
    ? t('settings.general.language.chinese')
    : t('settings.general.language.english')

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">{t('settings.general.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('settings.general.subtitle')}</p>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">{t('settings.general.appearance')}</p>
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.general.language.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.general.language.description')}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={loading || savingLocale}
                  className="flex min-w-32 items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="truncate">{languageLabel}</span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => handleLocaleSelect('en')} className="flex items-center justify-between">
                  <span>{t('settings.general.language.english')}</span>
                  {currentLocale === 'en' && <Check className="size-4 text-muted-foreground" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleLocaleSelect('zh')} className="flex items-center justify-between">
                  <span>{t('settings.general.language.chinese')}</span>
                  {currentLocale === 'zh' && <Check className="size-4 text-muted-foreground" />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {isMac && (
            <div className="flex items-center justify-between gap-4 border-t border-border p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t('settings.general.crispText.label')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('settings.general.crispText.description')}
                </p>
              </div>
              <Switch
                checked={crispText}
                onCheckedChange={handleCrispTextToggle}
                disabled={loading}
              />
            </div>
          )}
          {import.meta.env.DEV && (
          <div className="flex items-center justify-between gap-4 border-t border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.general.appIcon.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.general.appIcon.description')}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {iconDataUri && (
                <img src={iconDataUri} alt="" className="size-10 object-contain" />
              )}
              {customAppIconPath && (
                <button
                  onClick={handleResetIcon}
                  disabled={loading || iconBusy}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t('settings.general.appIcon.reset')}
                </button>
              )}
              <button
                onClick={handlePickIcon}
                disabled={loading || iconBusy}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('settings.general.appIcon.choose')}
              </button>
            </div>
          </div>
          )}
        </div>

        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">{t('settings.general.privacy')}</p>
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.general.analytics.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.general.analytics.description')}
              </p>
            </div>
            <Switch
              checked={analyticsEnabled}
              onCheckedChange={handleAnalyticsToggle}
              disabled={loading}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
