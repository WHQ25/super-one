import { useEffect, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Switch } from '@superone/ui/components/ui/switch'
import { Button } from '@superone/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import { cn } from '@superone/ui/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { shutdownAnalytics, startAnalytics } from '@/lib/analytics'
import { changeLocale } from '@/i18n'
import { useAppStore } from '@/stores/app'
import { DefaultProviderRow } from '@/components/providers/DefaultProviderRow'
import { NotificationSettingsSection } from '@/components/settings/NotificationSettingsSection'
import { SessionStorageSection } from '@/components/settings/SessionStorageSection'
import { JevFastLoopSetting } from '@/components/settings/JevFastLoopSetting'
import { settingsSelectTriggerClassName } from '@/components/settings/select-trigger-class'
import { SettingsPage, SettingsRow, SettingsSection, settingsRowClassName } from '@/components/settings/SettingsSection'
import type { Locale, PowerMode } from '@superone/shared/agent-types'

export function AppSettingsPage() {
  const { t, i18n } = useTranslation()
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savingLocale, setSavingLocale] = useState(false)
  const [powerMode, setPowerMode] = useState<PowerMode>('system')
  const [savingPowerMode, setSavingPowerMode] = useState(false)
  const [confirmPowerMode, setConfirmPowerMode] = useState(false)
  const appVersion = useAppStore((s) => s.appVersion)
  const appVariant = useAppStore((s) => s.appVariant)
  const alphaDownloadUrl = useAppStore((s) => s.alphaDownloadUrl)

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

  const experimentalClaudeOpenAiChatEnabled = useAppStore((s) => s.experimentalClaudeOpenAiChatEnabled)
  const setExperimentalClaudeOpenAiChatEnabled = useAppStore((s) => s.setExperimentalClaudeOpenAiChatEnabled)
  const experimentalRemoteNodesEnabled = useAppStore((s) => s.experimentalRemoteNodesEnabled)
  const setExperimentalRemoteNodesEnabled = useAppStore((s) => s.setExperimentalRemoteNodesEnabled)

  useEffect(() => {
    let mounted = true
    window.app.getAppSettings().then((settings) => {
      if (!mounted) return
      setAnalyticsEnabled(settings.analyticsEnabled)
      setPowerMode(settings.powerMode)
      setLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [])

  async function handleAnalyticsToggle(enabled: boolean) {
    const result = await window.app.saveAppSettings({ analyticsEnabled: enabled })
    setAnalyticsEnabled(result.analyticsEnabled)
    if (result.analyticsEnabled) {
      startAnalytics()
    } else {
      shutdownAnalytics()
    }
    toast.success(t(result.analyticsEnabled ? 'settings.general.analytics.enabled' : 'settings.general.analytics.disabled'))
  }

  async function handleClaudeOpenAiChatToggle(enabled: boolean) {
    await setExperimentalClaudeOpenAiChatEnabled(enabled)
    toast.success(t(enabled
      ? 'settings.general.experimentalClaudeOpenAiChat.enabled'
      : 'settings.general.experimentalClaudeOpenAiChat.disabled'))
  }

  async function handleRemoteNodesToggle(enabled: boolean) {
    await setExperimentalRemoteNodesEnabled(enabled)
    toast.success(t(enabled
      ? 'settings.general.experimentalRemoteNodes.enabled'
      : 'settings.general.experimentalRemoteNodes.disabled'))
  }

  async function savePowerMode(mode: PowerMode) {
    if (savingPowerMode || mode === powerMode) return
    setSavingPowerMode(true)
    try {
      const result = await window.app.saveAppSettings({ powerMode: mode })
      setPowerMode(result.powerMode)
      setConfirmPowerMode(false)
      toast.success(t('settings.general.powerMode.updated'))
    } catch (error) {
      toast.error(t('settings.general.powerMode.failed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSavingPowerMode(false)
    }
  }

  const powerModeOptions: Array<{
    value: PowerMode
    label: string
    description: string
  }> = [
    {
      value: 'system',
      label: t('settings.general.powerMode.system'),
      description: t('settings.general.powerMode.systemDescription'),
    },
    {
      value: 'prevent-idle-sleep',
      label: t('settings.general.powerMode.preventIdleSleep'),
      description: t('settings.general.powerMode.preventIdleSleepDescription'),
    },
    {
      value: 'lid-closed-on-ac',
      label: t('settings.general.powerMode.lidClosedOnAc'),
      description: t('settings.general.powerMode.lidClosedOnAcDescription'),
    },
  ]


  return (
    <SettingsPage title={t('settings.general.title')}>
      <SettingsSection title={t('settings.general.languageRegion')}>
        <SettingsRow
          label={t('settings.general.language.label')}
          description={t('settings.general.language.description')}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={savingLocale}
                className={cn(settingsSelectTriggerClassName, 'min-w-32 justify-between')}
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
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t('settings.general.updates')}>
        <UpdateCheckRow version={appVersion} />
        {appVariant === 'stable' && alphaDownloadUrl !== '' && (
          <SettingsRow
            label={t('settings.general.alphaBuild.label')}
            description={t('settings.general.alphaBuild.description')}
          >
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => void window.app.openExternalLink(alphaDownloadUrl)}
            >
              {t('settings.general.alphaBuild.action')}
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>

      <SettingsSection title={t('settings.general.media')}>
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
      </SettingsSection>

      <NotificationSettingsSection />

      <SessionStorageSection />

      <SettingsSection title={t('settings.general.privacy')}>
        <SettingsRow
          label={t('settings.general.analytics.label')}
          description={t('settings.general.analytics.description')}
        >
          <Switch
            checked={analyticsEnabled}
            onCheckedChange={handleAnalyticsToggle}
            disabled={loading}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t('settings.general.power')}>
        <div
          role="radiogroup"
          aria-label={t('settings.general.powerMode.label')}
          className="rounded-[inherit]"
        >
          {powerModeOptions.map((option) => {
            const selected = powerMode === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={loading || savingPowerMode}
                onClick={() => {
                  if (selected) return
                  if (option.value === 'lid-closed-on-ac') setConfirmPowerMode(true)
                  else void savePowerMode(option.value)
                }}
                className={cn(
                  settingsRowClassName,
                  'flex w-full items-center justify-between gap-4 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60',
                )}
              >
                <div className="min-w-0">
                  <p className="text-sm">{option.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{option.description}</p>
                </div>
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full border',
                    selected ? 'border-[5px] border-primary' : 'border-muted-foreground/50',
                  )}
                />
              </button>
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.general.experimental')}>
        <SettingsRow
          label={t('settings.general.experimentalClaudeOpenAiChat.label')}
          description={t('settings.general.experimentalClaudeOpenAiChat.description')}
        >
          <Switch
            checked={experimentalClaudeOpenAiChatEnabled}
            onCheckedChange={(v) => void handleClaudeOpenAiChatToggle(v)}
            disabled={loading}
          />
        </SettingsRow>
        <SettingsRow
          label={t('settings.general.experimentalRemoteNodes.label')}
          description={t('settings.general.experimentalRemoteNodes.description')}
        >
          <Switch
            checked={experimentalRemoteNodesEnabled}
            onCheckedChange={(v) => void handleRemoteNodesToggle(v)}
            disabled={loading}
          />
        </SettingsRow>
        <JevFastLoopSetting />
      </SettingsSection>
      <Dialog
        open={confirmPowerMode}
        onOpenChange={(open) => {
          if (!savingPowerMode) setConfirmPowerMode(open)
        }}
      >
        <DialogContent showCloseButton={false} className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings.general.powerMode.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('settings.general.powerMode.confirmDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>{t('settings.general.powerMode.warning')}</span>
          </div>
          {window.app.platform === 'darwin' && (
            <p className="text-xs text-muted-foreground">
              {t('settings.general.powerMode.macPermission')}
            </p>
          )}
          {window.app.platform === 'linux' && (
            <p className="text-xs text-muted-foreground">
              {t('settings.general.powerMode.linuxNote')}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={savingPowerMode}
              onClick={() => setConfirmPowerMode(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button disabled={savingPowerMode} onClick={() => void savePowerMode('lid-closed-on-ac')}>
              {t('settings.general.powerMode.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  )
}

/**
 * Manual update check plus the full download lifecycle. Auto-checking only
 * happens once at launch; when an update is found the user must click Update
 * to start the download, then Restart once it is ready.
 */
function UpdateCheckRow({ version }: { version: string }) {
  const { t } = useTranslation()
  const updateStatus = useAppStore((s) => s.updateStatus)
  const updateVersion = useAppStore((s) => s.updateVersion)
  const updateProgress = useAppStore((s) => s.updateProgress)
  const downloadUpdate = useAppStore((s) => s.downloadUpdate)
  const installUpdate = useAppStore((s) => s.installUpdate)
  const dismissUpdate = useAppStore((s) => s.dismissUpdate)

  const checking = updateStatus === 'checking'
  const available = updateStatus === 'available'
  const downloading = updateStatus === 'preparing' || updateStatus === 'downloading'
  const ready = updateStatus === 'ready'
  const percent = Math.min(100, Math.max(0, Math.round(updateProgress)))
  const targetVersion = updateVersion ? `v${updateVersion}` : ''

  const description = ready
    ? t('shell.update.ready', { version: updateVersion })
    : updateStatus === 'downloading'
      ? t('shell.update.downloadingWithProgress', { version: targetVersion, progress: percent })
      : updateStatus === 'preparing'
        ? t('shell.update.preparing', { version: targetVersion })
        : available
          ? t('shell.update.availableHint', { version: targetVersion })
          : updateStatus === 'checking'
            ? t('shell.update.checking')
            : updateStatus === 'up-to-date'
              ? t('shell.update.upToDate')
              : updateStatus === 'error'
                ? t('settings.general.checkUpdates.failed')
                : t('settings.general.checkUpdates.description', { version })

  return (
    <SettingsRow
      label={t('settings.general.checkUpdates.label')}
      description={(
        <span className={cn(updateStatus === 'error' && 'text-error')}>{description}</span>
      )}
      footer={downloading && (
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          {/* No progress events arrive while electron-updater fetches blockmaps, so an
              0%-wide bar would read as a stalled download — pulse the full bar instead. */}
          <div
            className={cn(
              'h-full rounded-full bg-primary',
              updateStatus === 'preparing' ? 'animate-pulse' : 'transition-[width] duration-300 ease-out',
            )}
            style={{ width: updateStatus === 'preparing' ? '100%' : `${percent}%` }}
          />
        </div>
      )}
    >
      {ready ? (
        <Button
          size="sm"
          className="h-7"
          onClick={import.meta.env.DEV ? dismissUpdate : installUpdate}
        >
          {t('shell.update.restart')}
        </Button>
      ) : available ? (
        <Button size="sm" className="h-7" onClick={downloadUpdate}>
          {t('shell.update.available')}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          disabled={checking || downloading}
          onClick={() => void window.app.checkForUpdates()}
        >
          <RefreshCw className={cn('size-3.5 text-muted-foreground', checking && 'animate-spin')} />
          {t('settings.general.checkUpdates.action')}
        </Button>
      )}
    </SettingsRow>
  )
}
