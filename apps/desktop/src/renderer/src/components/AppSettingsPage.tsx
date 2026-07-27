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
import { changeLocale } from '@/i18n'
import { useAppStore } from '@/stores/app'
import { DefaultProviderRow } from '@/components/providers/DefaultProviderRow'
import type { Locale, UpdateChannel } from '@superone/shared/agent-types'
import { AVAILABLE_UPDATE_CHANNELS, channelFromVersion } from '@superone/shared/update-channels'

export function AppSettingsPage() {
  const { t, i18n } = useTranslation()
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savingLocale, setSavingLocale] = useState(false)
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel | null>(null)
  const [savingChannel, setSavingChannel] = useState(false)
  const appVersion = useAppStore((s) => s.appVersion)

  const currentLocale: Locale = i18n.language === 'zh' ? 'zh' : 'en'
  const languageLabel = currentLocale === 'zh'
    ? t('settings.general.language.chinese')
    : t('settings.general.language.english')

  async function handleLocaleSelect(locale: Locale) {
    if (savingLocale || i18n.language === locale) return
    setSavingLocale(true)
    try {
      await changeLocale(locale)
      toast.success(i18n.t('settings.general.language.updated', { lng: locale }))
      setSavingLocale(false)
    } catch (e) {
      setSavingLocale(false)
      throw e
    }
  }

  const experimentalAgentsEnabled = useAppStore((s) => s.experimentalAgentsEnabled)
  const setExperimentalAgentsEnabled = useAppStore((s) => s.setExperimentalAgentsEnabled)
  const experimentalAgentCollaborationEnabled = useAppStore((s) => s.experimentalAgentCollaborationEnabled)
  const setExperimentalAgentCollaborationEnabled = useAppStore((s) => s.setExperimentalAgentCollaborationEnabled)

  useEffect(() => {
    let mounted = true
    window.app.getAppSettings().then((settings) => {
      if (!mounted) return
      setAnalyticsEnabled(settings.analyticsEnabled)
      setUpdateChannel(settings.updateChannel)
      setLoading(false)
    })
    return () => { mounted = false }
  }, [])

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

  async function handleExperimentalAgentsToggle(enabled: boolean) {
    await setExperimentalAgentsEnabled(enabled)
    toast.success(t(enabled ? 'settings.general.experimentalAgents.enabled' : 'settings.general.experimentalAgents.disabled'))
  }

  async function handleAgentCollaborationToggle(enabled: boolean) {
    await setExperimentalAgentCollaborationEnabled(enabled)
    toast.success(t(enabled
      ? 'settings.general.experimentalAgentCollaboration.enabled'
      : 'settings.general.experimentalAgentCollaboration.disabled'))
  }

  const effectiveChannel: UpdateChannel = updateChannel ?? channelFromVersion(appVersion)

  async function handleChannelSelect(channel: UpdateChannel) {
    if (savingChannel || effectiveChannel === channel) return
    setSavingChannel(true)
    try {
      const result = await window.app.saveAppSettings({ updateChannel: channel })
      setUpdateChannel(result.updateChannel)
      toast.success(t('settings.general.updateChannel.updated'))
      setSavingChannel(false)
    } catch (e) {
      setSavingChannel(false)
      throw e
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">{t('settings.general.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('settings.general.subtitle')}</p>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">{t('settings.general.languageRegion')}</p>
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
                  disabled={savingLocale}
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
        </div>

        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">{t('settings.general.updates')}</p>
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.general.updateChannel.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.general.updateChannel.description')}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={loading || savingChannel}
                  className="flex min-w-32 items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="truncate">{t(`settings.general.updateChannel.${effectiveChannel}`)}</span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {AVAILABLE_UPDATE_CHANNELS.map((channel) => (
                  <DropdownMenuItem
                    key={channel}
                    onClick={() => handleChannelSelect(channel)}
                    className="flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm">{t(`settings.general.updateChannel.${channel}`)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t(`settings.general.updateChannel.${channel}Description`)}
                      </p>
                    </div>
                    {effectiveChannel === channel && <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">{t('settings.general.media')}</p>
          </div>
          <DefaultProviderRow
            consumer="media:image"
            title={t('settings.general.imageProvider.label')}
            description={t('settings.general.imageProvider.description')}
            fallback={<span className="truncate text-sm text-muted-foreground">{t('settings.general.imageProvider.auto')}</span>}
          />
          <DefaultProviderRow
            consumer="media:video"
            title={t('settings.general.videoProvider.label')}
            description={t('settings.general.videoProvider.description')}
            fallback={<span className="truncate text-sm text-muted-foreground">{t('settings.general.videoProvider.auto')}</span>}
          />
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

        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">{t('settings.general.experimental')}</p>
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.general.experimentalAgents.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.general.experimentalAgents.description')}
              </p>
            </div>
            <Switch
              checked={experimentalAgentsEnabled}
              onCheckedChange={(v) => void handleExperimentalAgentsToggle(v)}
              disabled={loading}
            />
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.general.experimentalAgentCollaboration.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.general.experimentalAgentCollaboration.description')}
              </p>
            </div>
            <Switch
              checked={experimentalAgentCollaborationEnabled}
              onCheckedChange={(v) => void handleAgentCollaborationToggle(v)}
              disabled={loading}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
