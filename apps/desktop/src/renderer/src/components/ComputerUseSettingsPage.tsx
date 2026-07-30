import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, CircleAlert, Loader2, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@superone/ui/components/ui/badge'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { Switch } from '@superone/ui/components/ui/switch'
import { cn } from '@superone/ui/lib/utils'
import type { ComputerUseAlwaysAllowApp } from '@superone/shared/agent-types'

type RunningApp = { app: string; bundleId: string; pid: number; frontmost: boolean }
type PermissionStatus = {
  accessibility?: string
  screenRecording?: string
  helperName?: string
  helperBundleId?: string
  helperPath?: string
  screenRecordingNeedsRelaunch?: boolean
  reason?: string
  error?: string
}

function isPermissionGranted(value?: string): boolean {
  return value === 'granted'
}

export function ComputerUseSettingsPage() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(false)
  const [allowAll, setAllowAll] = useState(false)
  const [alwaysAllow, setAlwaysAllow] = useState<ComputerUseAlwaysAllowApp[]>([])
  const [loading, setLoading] = useState(true)
  const [permBusy, setPermBusy] = useState(false)
  const [permChecking, setPermChecking] = useState(true)
  const [recheckBusy, setRecheckBusy] = useState(false)
  const [permMessage, setPermMessage] = useState<string | null>(null)
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>({})
  const [runningApps, setRunningApps] = useState<RunningApp[]>([])
  const [runningBusy, setRunningBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addQuery, setAddQuery] = useState('')

  const accessibilityGranted = isPermissionGranted(permissionStatus.accessibility)
  const screenRecordingGranted = isPermissionGranted(permissionStatus.screenRecording)
  const permissionsFullyGranted = accessibilityGranted && screenRecordingGranted

  useEffect(() => {
    let mounted = true
    window.app.getAppSettings().then((settings) => {
      if (!mounted) return
      setEnabled(settings.computerUseEnabled === true)
      setAllowAll(settings.computerUseAllowAllApps === true)
      setAlwaysAllow(settings.computerUseAlwaysAllowApps ?? [])
      setLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [])

  // Check once on enter; also live-update when the permission float polls grants.
  useEffect(() => {
    let mounted = true
    setPermChecking(true)
    void window.app.openComputerUsePermissions(false).then((result) => {
      if (!mounted) return
      if (!result.error) setPermissionStatus(result)
      setPermChecking(false)
    }).catch(() => {
      if (!mounted) return
      setPermChecking(false)
    })

    const unsub = window.app.onComputerUsePermissionStatus((next) => {
      if (!mounted) return
      setPermissionStatus((prev) => ({
        ...prev,
        ...(next.accessibility != null ? { accessibility: next.accessibility } : {}),
        ...(next.screenRecording != null ? { screenRecording: next.screenRecording } : {}),
        ...(next.helperName != null ? { helperName: next.helperName } : {}),
        ...(next.helperBundleId != null ? { helperBundleId: next.helperBundleId } : {}),
        ...(next.helperPath != null ? { helperPath: next.helperPath } : {}),
        ...(next.screenRecordingNeedsRelaunch != null
          ? { screenRecordingNeedsRelaunch: next.screenRecordingNeedsRelaunch }
          : {}),
      }))
      setPermChecking(false)
    })

    return () => {
      mounted = false
      unsub()
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
    const turningOn = value && !enabled
    const result = await window.app.saveAppSettings({ computerUseEnabled: value })
    setEnabled(result.computerUseEnabled === true)
    setAllowAll(result.computerUseAllowAllApps === true)
    setAlwaysAllow(result.computerUseAlwaysAllowApps ?? [])
    // First enable: open the combined two-step guided float when anything is missing.
    if (turningOn && !permissionsFullyGranted) {
      await requestPermission('guided')
    }
  }

  async function handleAllowAllToggle(value: boolean) {
    const result = await window.app.saveAppSettings({ computerUseAllowAllApps: value })
    setAllowAll(result.computerUseAllowAllApps === true)
    if (result.computerUseAllowAllApps === true) setAddOpen(false)
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

  async function handleRecheckPermissions() {
    setRecheckBusy(true)
    setPermMessage(null)
    try {
      const result = await window.app.recheckComputerUsePermissions()
      if (result.error) {
        setPermMessage(result.error)
        return
      }
      setPermissionStatus(result)
      if (
        isPermissionGranted(result.accessibility)
        && isPermissionGranted(result.screenRecording)
      ) {
        setPermMessage(t('settings.computerUse.permissions.alreadyGranted'))
      } else {
        setPermMessage(
          t('settings.computerUse.permissions.recheckStillMissing', {
            helperName:
              result.helperName ?? t('settings.computerUse.permissions.helperName'),
          }),
        )
      }
    } catch (err) {
      setPermMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setRecheckBusy(false)
    }
  }

  async function requestPermission(
    target: 'guided' | 'accessibility' | 'screenRecording',
  ) {
    if (target === 'guided' && permissionsFullyGranted) {
      setPermMessage(t('settings.computerUse.permissions.alreadyGranted'))
      return
    }
    if (target === 'accessibility' && accessibilityGranted) {
      setPermMessage(t('settings.computerUse.permissions.accessibilityGranted'))
      return
    }
    if (target === 'screenRecording' && screenRecordingGranted) {
      setPermMessage(t('settings.computerUse.permissions.screenRecordingGranted'))
      return
    }

    setPermBusy(true)
    setPermMessage(null)
    try {
      const result = await window.app.openComputerUsePermissions(target === 'guided' ? 'guided' : target)
      setPermissionStatus(result)
      if (result.error) {
        setPermMessage(result.error)
      } else if (
        result.reason === 'already_granted'
        || (isPermissionGranted(result.accessibility) && isPermissionGranted(result.screenRecording))
      ) {
        setPermMessage(t('settings.computerUse.permissions.alreadyGranted'))
      } else {
        setPermMessage(t('settings.computerUse.permissions.requested'))
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

      <div className="space-y-4">
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
              disabled={loading || permBusy}
            />
          </div>

          <div className="flex items-start justify-between gap-4 border-t border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.computerUse.allowAll.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.computerUse.allowAll.description')}
              </p>
            </div>
            <Switch
              checked={enabled && allowAll}
              onCheckedChange={handleAllowAllToggle}
              disabled={loading || !enabled}
            />
          </div>
        </div>

        {!(enabled && allowAll) && (
          <div className="rounded-lg border border-border">
            <div className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t('settings.computerUse.alwaysAllow.title')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('settings.computerUse.alwaysAllow.description')}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || !enabled}
                onClick={() => setAddOpen((v) => !v)}
              >
                <Plus data-icon="inline-start" />
                {t('settings.computerUse.alwaysAllow.add')}
              </Button>
            </div>

            {addOpen && (
              <div className="border-t border-border px-4 py-3">
                <Input
                  type="search"
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  placeholder={t('settings.computerUse.alwaysAllow.searchPlaceholder')}
                />
                <div className="mt-2 flex max-h-48 flex-col gap-0.5 overflow-y-auto">
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
                      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                      onClick={() => void handleAddAlways({ app: app.app, bundleId: app.bundleId })}
                    >
                      <span className="min-w-0 truncate text-xs font-medium text-foreground">{app.app}</span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{app.bundleId}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <ul className="divide-y divide-border border-t border-border">
              {alwaysAllow.length === 0 ? (
                <li className="px-4 py-3 text-xs text-muted-foreground">
                  {t('settings.computerUse.alwaysAllow.empty')}
                </li>
              ) : (
                alwaysAllow.map((app) => (
                  <li key={app.bundleId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{app.app}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">{app.bundleId}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => void handleRemoveAlways(app.bundleId)}
                      aria-label={t('settings.computerUse.alwaysAllow.remove', { app: app.app })}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}

        <div className="rounded-lg border border-border">
          <div className="flex items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.computerUse.permissions.title')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.computerUse.permissions.description')}
              </p>
              {(permissionStatus.helperName || permissionStatus.helperPath) && (
                <div className="mt-2 min-w-0 text-xs text-muted-foreground">
                  <p className="truncate font-medium text-foreground">
                    {permissionStatus.helperName ?? t('settings.computerUse.permissions.helperName')}
                  </p>
                  {permissionStatus.helperBundleId && (
                    <p className="truncate font-mono text-[11px]" title={permissionStatus.helperBundleId}>
                      {permissionStatus.helperBundleId}
                    </p>
                  )}
                  {permissionStatus.helperPath && (
                    <p className="truncate font-mono text-[11px]" title={permissionStatus.helperPath}>
                      {permissionStatus.helperPath}
                    </p>
                  )}
                </div>
              )}
              {!permissionStatus.helperName && !permissionStatus.helperPath && !permChecking && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('settings.computerUse.permissions.helperName')}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={permBusy || permChecking || recheckBusy}
              onClick={() => void handleRecheckPermissions()}
            >
              {recheckBusy
                ? t('settings.computerUse.permissions.rechecking')
                : t('settings.computerUse.permissions.recheck')}
            </Button>
          </div>

          {permChecking ? (
            <div className="border-t border-border px-4 py-3">
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                {t('settings.computerUse.permissions.checking')}
              </Badge>
            </div>
          ) : (
            <div className="divide-y divide-border border-t border-border">
              <PermissionRow
                label={t('settings.computerUse.permissions.accessibility')}
                granted={accessibilityGranted}
                busy={permBusy}
                checking={permChecking}
                onRequest={() => void requestPermission('accessibility')}
                requestLabel={t('settings.computerUse.permissions.requestAccessibility')}
                grantedLabel={t('settings.computerUse.permissions.buttonGranted')}
                openingLabel={t('settings.computerUse.permissions.opening')}
              />
              <PermissionRow
                label={t('settings.computerUse.permissions.screenRecording')}
                granted={screenRecordingGranted}
                busy={permBusy}
                checking={permChecking}
                onRequest={() => void requestPermission('screenRecording')}
                requestLabel={t('settings.computerUse.permissions.requestScreenRecording')}
                grantedLabel={t('settings.computerUse.permissions.buttonGranted')}
                openingLabel={t('settings.computerUse.permissions.opening')}
              />
            </div>
          )}

          {permMessage && (
            <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">{permMessage}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function PermissionRow({
  label,
  granted,
  busy,
  checking,
  onRequest,
  requestLabel,
  grantedLabel,
  openingLabel,
}: {
  label: string
  granted: boolean
  busy: boolean
  checking: boolean
  onRequest: () => void
  requestLabel: string
  grantedLabel: string
  openingLabel: string
}) {
  const Icon = granted ? CheckCircle2 : CircleAlert
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <Icon
          className={cn('size-4 shrink-0', granted ? 'text-emerald-500' : 'text-muted-foreground')}
          aria-hidden="true"
        />
        <span className="text-sm text-foreground">{label}</span>
      </div>
      {granted ? (
        <Badge
          variant="outline"
          className="border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
        >
          {grantedLabel}
        </Badge>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || checking}
          onClick={onRequest}
        >
          {busy ? openingLabel : requestLabel}
        </Button>
      )}
    </div>
  )
}
