import { useEffect, useState } from 'react'
import { Check, ChevronDown, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Switch } from '@superone/ui/components/ui/switch'
import { Input } from '@superone/ui/components/ui/input'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { initAnalytics, shutdownAnalytics } from '@/lib/analytics'
import { changeLocale } from '@/i18n'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { DefaultProviderRow } from '@/components/providers/DefaultProviderRow'
import type {
  Locale,
  UpdateChannel,
} from '@superone/shared/agent-types'
import { AVAILABLE_UPDATE_CHANNELS, channelFromVersion } from '@superone/shared/update-channels'

function CursorApiKeySettingsRow() {
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [cloud, setCloud] = useState(false)
  const [autoCreatePR, setAutoCreatePR] = useState(false)
  const [workOnCurrentBranch, setWorkOnCurrentBranch] = useState(false)
  const [cloudEnvType, setCloudEnvType] = useState<'cloud' | 'pool' | 'machine'>('cloud')
  const [repoUrl, setRepoUrl] = useState('')
  const [repos, setRepos] = useState<Array<{ url: string }>>([])
  const initializeHarness = useChatStore((s) => s.initializeHarness)

  useEffect(() => {
    void window.app.cursorListRepositories()
      .then((list) => setRepos(list))
      .catch(() => setRepos([]))
  }, [])

  async function saveKey() {
    if (!apiKey.trim() || saving) return
    setSaving(true)
    try {
      await window.app.setCursorApiKey(apiKey.trim())
      setApiKey('')
      toast.success('Cursor API key saved')
      void initializeHarness('cursor')
      void window.app.cursorListRepositories()
        .then((list) => setRepos(list))
        .catch(() => undefined)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function saveRuntime() {
    setSaving(true)
    try {
      await window.app.updateCursorBaseConfig({
        runtime: cloud ? 'cloud' : 'local',
        autoCreatePR: cloud ? autoCreatePR : false,
        workOnCurrentBranch: cloud ? workOnCurrentBranch : false,
        cloudEnvType: cloud ? cloudEnvType : 'cloud',
        ...(cloud && repoUrl.trim()
          ? { repos: [{ url: repoUrl.trim() }] }
          : { repos: [] }),
      })
      toast.success(cloud ? 'Cursor cloud runtime enabled' : 'Cursor local runtime enabled')
      void initializeHarness('cursor')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 border-t border-border p-4">
      <p className="text-sm font-medium">Cursor User API Key</p>
      <p className="text-xs text-muted-foreground">
        Create a key at{' '}
        <a
          className="underline underline-offset-2"
          href="https://cursor.com/dashboard/api"
          target="_blank"
          rel="noreferrer"
        >
          cursor.com/dashboard/api
        </a>
        . Desktop login alone is not enough for the SDK.
      </p>
      <div className="flex gap-2">
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="cursor_…"
          className="font-mono text-xs"
          autoComplete="off"
        />
        <Button type="button" size="sm" disabled={!apiKey.trim() || saving} onClick={() => void saveKey()}>
          Save
        </Button>
      </div>
      <div className="flex items-center justify-between gap-4 pt-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Cursor Cloud Agents</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Secondary runtime (bc-*). Local project chat remains the default when off.
          </p>
        </div>
        <Switch checked={cloud} onCheckedChange={setCloud} disabled={saving} />
      </div>
      {cloud && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {(['cloud', 'pool', 'machine'] as const).map((env) => (
              <button
                key={env}
                type="button"
                disabled={saving}
                onClick={() => setCloudEnvType(env)}
                className={
                  cloudEnvType === env
                    ? 'rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground'
                    : 'rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted'
                }
              >
                {env}
              </button>
            ))}
          </div>
          <Input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/org/repo"
            className="font-mono text-xs"
            list="cursor-repo-suggestions"
          />
          {repos.length > 0 && (
            <datalist id="cursor-repo-suggestions">
              {repos.map((r) => (
                <option key={r.url} value={r.url} />
              ))}
            </datalist>
          )}
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">Auto-create PR when cloud agent finishes</p>
            <Switch checked={autoCreatePR} onCheckedChange={setAutoCreatePR} disabled={saving} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">Work on current branch</p>
            <Switch checked={workOnCurrentBranch} onCheckedChange={setWorkOnCurrentBranch} disabled={saving} />
          </div>
        </div>
      )}
      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void saveRuntime()}>
        Save Cursor runtime
      </Button>
    </div>
  )
}

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

  const experimentalClaudeOpenAiChatEnabled = useAppStore((s) => s.experimentalClaudeOpenAiChatEnabled)
  const setExperimentalClaudeOpenAiChatEnabled = useAppStore((s) => s.setExperimentalClaudeOpenAiChatEnabled)
  const experimentalRemoteNodesEnabled = useAppStore((s) => s.experimentalRemoteNodesEnabled)
  const setExperimentalRemoteNodesEnabled = useAppStore((s) => s.setExperimentalRemoteNodesEnabled)

  useEffect(() => {
    let mounted = true
    window.app.getAppSettings().then((settings) => {
      if (!mounted) return
      setAnalyticsEnabled(settings.analyticsEnabled)
      setUpdateChannel(settings.updateChannel)
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
      initAnalytics()
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
          <UpdateCheckRow version={appVersion} />
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
              <p className="text-sm font-medium">{t('settings.general.experimentalClaudeOpenAiChat.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.general.experimentalClaudeOpenAiChat.description')}
              </p>
            </div>
            <Switch
              checked={experimentalClaudeOpenAiChatEnabled}
              onCheckedChange={(v) => void handleClaudeOpenAiChatToggle(v)}
              disabled={loading}
            />
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.general.experimentalRemoteNodes.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.general.experimentalRemoteNodes.description')}
              </p>
            </div>
            <Switch
              checked={experimentalRemoteNodesEnabled}
              onCheckedChange={(v) => void handleRemoteNodesToggle(v)}
              disabled={loading}
            />
          </div>
          {experimentalAgentsEnabled && (
            <CursorApiKeySettingsRow />
          )}
        </div>
      </div>
    </div>
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
    <div className="border-t border-border p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('settings.general.checkUpdates.label')}</p>
          <p className={cn('mt-0.5 text-xs', updateStatus === 'error' ? 'text-error' : 'text-muted-foreground')}>
            {description}
          </p>
        </div>
        {ready ? (
          <Button
            size="sm"
            className="shrink-0"
            onClick={import.meta.env.DEV ? dismissUpdate : installUpdate}
          >
            {t('shell.update.restart')}
          </Button>
        ) : available ? (
          <Button size="sm" className="shrink-0" onClick={downloadUpdate}>
            {t('shell.update.available')}
          </Button>
        ) : (
          <button
            disabled={checking || downloading}
            onClick={() => void window.app.checkForUpdates()}
            className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={cn('size-3.5 shrink-0 text-muted-foreground', checking && 'animate-spin')} />
            <span>{t('settings.general.checkUpdates.action')}</span>
          </button>
        )}
      </div>
      {downloading && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
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
    </div>
  )
}
