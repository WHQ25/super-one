import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { Button } from '@superone/ui/components/ui/button'
import { Switch } from '@superone/ui/components/ui/switch'
import type { ComputerUseAlwaysAllowApp } from '@superone/shared/agent-types'

type RunningApp = { app: string; bundleId: string; pid: number; frontmost: boolean }

export function ComputerUseSettingsPage() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(false)
  const [allowAll, setAllowAll] = useState(false)
  const [visualIndicators, setVisualIndicators] = useState(true)
  const [alwaysAllow, setAlwaysAllow] = useState<ComputerUseAlwaysAllowApp[]>([])
  const [loading, setLoading] = useState(true)
  const [permBusy, setPermBusy] = useState(false)
  const [permMessage, setPermMessage] = useState<string | null>(null)
  const [runningApps, setRunningApps] = useState<RunningApp[]>([])
  const [runningBusy, setRunningBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addQuery, setAddQuery] = useState('')

  useEffect(() => {
    let mounted = true
    window.app.getAppSettings().then((settings) => {
      if (!mounted) return
      setEnabled(settings.computerUseEnabled === true)
      setAllowAll(settings.computerUseAllowAllApps === true)
      setVisualIndicators(settings.computerUseVisualIndicators !== false)
      setAlwaysAllow(settings.computerUseAlwaysAllowApps ?? [])
      setLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [])

  const refreshRunning = useCallback(async () => {
    setRunningBusy(true)
    try {
      const apps = await window.app.listComputerUseRunningApps()
      setRunningApps(apps)
    } catch {
      setRunningApps([])
    } finally {
      setRunningBusy(false)
    }
  }, [])

  useEffect(() => {
    if (addOpen) void refreshRunning()
  }, [addOpen, refreshRunning])

  async function handleEnableToggle(value: boolean) {
    const result = await window.app.saveAppSettings({ computerUseEnabled: value })
    setEnabled(result.computerUseEnabled === true)
    setAllowAll(result.computerUseAllowAllApps === true)
    setVisualIndicators(result.computerUseVisualIndicators !== false)
    setAlwaysAllow(result.computerUseAlwaysAllowApps ?? [])
  }

  async function handleAllowAllToggle(value: boolean) {
    const result = await window.app.saveAppSettings({ computerUseAllowAllApps: value })
    setAllowAll(result.computerUseAllowAllApps === true)
  }

  async function handleVisualIndicatorsToggle(value: boolean) {
    const result = await window.app.saveAppSettings({ computerUseVisualIndicators: value })
    setVisualIndicators(result.computerUseVisualIndicators !== false)
  }

  async function persistAlwaysAllow(next: ComputerUseAlwaysAllowApp[]) {
    const result = await window.app.saveAppSettings({ computerUseAlwaysAllowApps: next })
    setAlwaysAllow(result.computerUseAlwaysAllowApps ?? [])
  }

  async function handleRemoveAlways(bundleId: string) {
    await persistAlwaysAllow(alwaysAllow.filter((a) => a.bundleId !== bundleId))
  }

  async function handleAddAlways(app: ComputerUseAlwaysAllowApp) {
    if (alwaysAllow.some((a) => a.bundleId === app.bundleId)) {
      setAddOpen(false)
      setAddQuery('')
      return
    }
    await persistAlwaysAllow([...alwaysAllow, app])
    setAddOpen(false)
    setAddQuery('')
  }

  async function handleOpenPermissions() {
    setPermBusy(true)
    setPermMessage(null)
    try {
      const result = await window.app.openComputerUsePermissions()
      if (result.error) {
        setPermMessage(result.error)
      } else if (result.reason === 'already_granted') {
        setPermMessage(t('settings.computerUse.permissions.alreadyGranted'))
      } else if (result.presented) {
        setPermMessage(t('settings.computerUse.permissions.opened'))
      } else {
        setPermMessage(t('settings.computerUse.permissions.opened'))
      }
    } catch (err) {
      setPermMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setPermBusy(false)
    }
  }

  const filteredRunning = useMemo(() => {
    const q = addQuery.trim().toLowerCase()
    const granted = new Set(alwaysAllow.map((a) => a.bundleId))
    return runningApps
      .filter((a) => !granted.has(a.bundleId))
      .filter((a) => {
        if (!q) return true
        return a.app.toLowerCase().includes(q) || a.bundleId.toLowerCase().includes(q)
      })
      .slice(0, 40)
  }, [runningApps, alwaysAllow, addQuery])

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">{t('settings.computerUse.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('settings.computerUse.subtitle')}</p>
      </div>

      <div className="rounded-lg border border-border">
        <div className="flex items-start justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('settings.computerUse.enable.label')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('settings.computerUse.enable.description')}
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={handleEnableToggle}
            disabled={loading}
          />
        </div>

        <div className="flex items-start justify-between gap-4 border-t border-border p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('settings.computerUse.allowAll.label')}</p>
            <p className={cn('mt-0.5 text-xs', allowAll ? 'text-destructive' : 'text-muted-foreground')}>
              {t('settings.computerUse.allowAll.description')}
            </p>
          </div>
          <Switch
            checked={enabled && allowAll}
            onCheckedChange={handleAllowAllToggle}
            disabled={loading || !enabled}
          />
        </div>

        <div className="flex items-start justify-between gap-4 border-t border-border p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('settings.computerUse.visualIndicators.label')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('settings.computerUse.visualIndicators.description')}
            </p>
          </div>
          <Switch
            checked={enabled && visualIndicators}
            onCheckedChange={handleVisualIndicatorsToggle}
            disabled={loading || !enabled}
          />
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('settings.computerUse.alwaysAllow.title')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('settings.computerUse.alwaysAllow.description')}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading || !enabled}
            onClick={() => setAddOpen((v) => !v)}
          >
            <Plus className="mr-1 size-3.5" />
            {t('settings.computerUse.alwaysAllow.add')}
          </Button>
        </div>

        {addOpen && (
          <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
            <input
              type="text"
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
              placeholder={t('settings.computerUse.alwaysAllow.searchPlaceholder')}
              className="h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
              {runningBusy && (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  {t('settings.computerUse.alwaysAllow.loadingApps')}
                </p>
              )}
              {!runningBusy && filteredRunning.length === 0 && (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  {t('settings.computerUse.alwaysAllow.emptyRunning')}
                </p>
              )}
              {filteredRunning.map((app) => (
                <button
                  key={app.bundleId}
                  type="button"
                  className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
                  onClick={() => void handleAddAlways({ app: app.app, bundleId: app.bundleId })}
                >
                  <span className="min-w-0 truncate text-xs font-medium text-foreground">{app.app}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{app.bundleId}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <ul className="mt-3 divide-y divide-border rounded-md border border-border">
          {alwaysAllow.length === 0 ? (
            <li className="px-3 py-3 text-xs text-muted-foreground">
              {t('settings.computerUse.alwaysAllow.empty')}
            </li>
          ) : (
            alwaysAllow.map((app) => (
              <li key={app.bundleId} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{app.app}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{app.bundleId}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => void handleRemoveAlways(app.bundleId)}
                  aria-label={t('settings.computerUse.alwaysAllow.remove', { app: app.app })}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="mt-4 rounded-lg border border-border p-4">
        <p className="text-sm font-medium">{t('settings.computerUse.permissions.title')}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('settings.computerUse.permissions.description')}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={permBusy}
            onClick={() => void handleOpenPermissions()}
          >
            {permBusy
              ? t('settings.computerUse.permissions.opening')
              : t('settings.computerUse.permissions.button')}
          </Button>
          {permMessage && (
            <p className="text-xs text-muted-foreground">{permMessage}</p>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-2 rounded-lg border border-border p-4">
        <p className="text-xs text-muted-foreground">{t('settings.computerUse.helperNote')}</p>
        <p className="text-xs text-muted-foreground">{t('settings.computerUse.fallbackNote')}</p>
      </div>
    </div>
  )
}
