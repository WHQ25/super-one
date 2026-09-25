import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, CircleAlert, Loader2, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@superone/ui/components/ui/badge'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@superone/ui/components/ui/select'
import { Switch } from '@superone/ui/components/ui/switch'
import { cn } from '@superone/ui/lib/utils'
import { SettingsPage, SettingsRow, SettingsSection, settingsRowClassName } from '@/components/settings/SettingsSection'
import { SettingsFootnote } from '@/components/settings/SettingsFootnote'
import type {
  ComputerUseAlwaysAllowApp,
  ComputerUseDisplayInfo,
} from '@superone/shared/agent-types'

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
  const [pictureInPicture, setPictureInPicture] = useState(true)
  const [dedicatedDisplayId, setDedicatedDisplayId] = useState<string | null>(null)
  const [displays, setDisplays] = useState<ComputerUseDisplayInfo[]>([])
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
    Promise.all([
      window.app.getAppSettings(),
      window.app.listComputerUseDisplays().catch(() => [] as ComputerUseDisplayInfo[]),
    ]).then(([settings, connectedDisplays]) => {
      if (!mounted) return
      setEnabled(settings.computerUseEnabled === true)
      setPictureInPicture(settings.computerUsePictureInPicture !== false)
      setDedicatedDisplayId(settings.computerUseDedicatedDisplayId ?? null)
      setDisplays(connectedDisplays)
      setAllowAll(settings.computerUseAllowAllApps === true)
      setAlwaysAllow(settings.computerUseAlwaysAllowApps ?? [])
      setLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const unsubscribe = window.app.onComputerUseDisplaysChanged(() => {
      void window.app.listComputerUseDisplays()
        .then((connectedDisplays) => {
          if (mounted) setDisplays(connectedDisplays)
        })
        .catch(() => {
          if (mounted) setDisplays([])
        })
    })
    return () => {
      mounted = false
      unsubscribe()
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
    setPictureInPicture(result.computerUsePictureInPicture !== false)
    setDedicatedDisplayId(result.computerUseDedicatedDisplayId ?? null)
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

  async function handlePictureInPictureToggle(value: boolean) {
    const result = await window.app.saveAppSettings({ computerUsePictureInPicture: value })
    setPictureInPicture(result.computerUsePictureInPicture !== false)
  }

  async function handleDedicatedDisplayChange(value: string) {
    const result = await window.app.saveAppSettings({
      computerUseDedicatedDisplayId: value === '__current__' ? null : value,
    })
    setDedicatedDisplayId(result.computerUseDedicatedDisplayId ?? null)
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

  const dedicatedDisplayOptions = useMemo(
    () => displays.length > 1
      ? displays
      : displays.filter((display) => display.id === dedicatedDisplayId),
    [dedicatedDisplayId, displays],
  )
  const selectedDisplayAvailable = dedicatedDisplayId == null
    || displays.some((display) => display.id === dedicatedDisplayId)
  const hasSecondaryDisplay = displays.length > 1

  return (
    <SettingsPage title={t('settings.computerUse.title')}>
      <SettingsSection>
        <SettingsRow
          label={t('settings.computerUse.enable.label')}
          description={t('settings.computerUse.enable.description')}
        >
          <Switch
            checked={enabled}
            onCheckedChange={handleEnableToggle}
            disabled={loading || permBusy}
          />
        </SettingsRow>

        <SettingsRow
          label={t('settings.computerUse.pictureInPicture.label')}
          description={t('settings.computerUse.pictureInPicture.description')}
        >
          <Switch
            aria-label={t('settings.computerUse.pictureInPicture.label')}
            checked={enabled && pictureInPicture}
            onCheckedChange={handlePictureInPictureToggle}
            disabled={loading || !enabled}
          />
        </SettingsRow>

        <SettingsRow
          label={t('settings.computerUse.dedicatedDisplay.label')}
          description={hasSecondaryDisplay
            ? t('settings.computerUse.dedicatedDisplay.description')
            : t('settings.computerUse.dedicatedDisplay.singleDisplayDescription')}
        >
          <Select
            value={dedicatedDisplayId ?? '__current__'}
            onValueChange={handleDedicatedDisplayChange}
            disabled={loading || !enabled || (!hasSecondaryDisplay && dedicatedDisplayId == null)}
          >
            <SelectTrigger
              size="sm"
              className="w-52 shrink-0 border-border bg-background px-2.5 data-[size=sm]:h-7 dark:bg-background"
              aria-label={t('settings.computerUse.dedicatedDisplay.label')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="__current__">
                  {t('settings.computerUse.dedicatedDisplay.current')}
                </SelectItem>
                {!selectedDisplayAvailable && dedicatedDisplayId && (
                  <SelectItem value={dedicatedDisplayId} disabled>
                    {t('settings.computerUse.dedicatedDisplay.unavailable')}
                  </SelectItem>
                )}
                {dedicatedDisplayOptions.map((display) => (
                  <SelectItem key={display.id} value={display.id}>
                    {display.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          label={t('settings.computerUse.allowAll.label')}
          description={t('settings.computerUse.allowAll.description')}
        >
          <Switch
            checked={enabled && allowAll}
            onCheckedChange={handleAllowAllToggle}
            disabled={loading || !enabled}
          />
        </SettingsRow>
      </SettingsSection>

      {!(enabled && allowAll) && (
        <div>
          <SettingsSection
            title={t('settings.computerUse.alwaysAllow.title')}
            actions={(
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7"
                disabled={loading || !enabled}
                onClick={() => setAddOpen((v) => !v)}
              >
                <Plus data-icon="inline-start" />
                {t('settings.computerUse.alwaysAllow.add')}
              </Button>
            )}
          >
            {addOpen && (
              <div className={settingsRowClassName}>
                <Input
                  type="search"
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  placeholder={t('settings.computerUse.alwaysAllow.searchPlaceholder')}
                  className="h-7 bg-background"
                />
                <div className="-mx-1 mt-2 flex max-h-48 flex-col gap-0.5 overflow-y-auto">
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

            {alwaysAllow.length === 0 ? (
              <p className={cn(settingsRowClassName, 'text-xs text-muted-foreground')}>
                {t('settings.computerUse.alwaysAllow.empty')}
              </p>
            ) : (
              alwaysAllow.map((app) => (
                <SettingsRow
                  key={app.bundleId}
                  label={<span className="block truncate">{app.app}</span>}
                  description={<span className="block truncate font-mono text-[11px]">{app.bundleId}</span>}
                >
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
                </SettingsRow>
              ))
            )}
          </SettingsSection>
          <SettingsFootnote>{t('settings.computerUse.alwaysAllow.description')}</SettingsFootnote>
        </div>
      )}

      <div>
        <SettingsSection
          title={t('settings.computerUse.permissions.title')}
          actions={(
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0"
              disabled={permBusy || permChecking || recheckBusy}
              onClick={() => void handleRecheckPermissions()}
            >
              {recheckBusy
                ? t('settings.computerUse.permissions.rechecking')
                : t('settings.computerUse.permissions.recheck')}
            </Button>
          )}
        >
          {(permissionStatus.helperName || permissionStatus.helperPath || !permChecking) && (
            <SettingsRow
              label={<span className="block truncate">{permissionStatus.helperName ?? t('settings.computerUse.permissions.helperName')}</span>}
              description={(permissionStatus.helperBundleId || permissionStatus.helperPath) && (
                <span className="block font-mono text-[11px]">
                  {permissionStatus.helperBundleId && (
                    <span className="block truncate" title={permissionStatus.helperBundleId}>
                      {permissionStatus.helperBundleId}
                    </span>
                  )}
                  {permissionStatus.helperPath && (
                    <span className="block truncate" title={permissionStatus.helperPath}>
                      {permissionStatus.helperPath}
                    </span>
                  )}
                </span>
              )}
            />
          )}

          {permChecking ? (
            <div className={settingsRowClassName}>
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                {t('settings.computerUse.permissions.checking')}
              </Badge>
            </div>
          ) : (
            <>
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
            </>
          )}

          {permMessage && (
            <p className={cn(settingsRowClassName, 'text-xs text-muted-foreground')}>{permMessage}</p>
          )}
        </SettingsSection>
        <SettingsFootnote>{t('settings.computerUse.permissions.description')}</SettingsFootnote>
      </div>
    </SettingsPage>
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
    <SettingsRow
      label={(
        <span className="flex min-w-0 items-center gap-2">
          <Icon
            className={cn('size-4 shrink-0', granted ? 'text-success' : 'text-muted-foreground')}
            aria-hidden="true"
          />
          {label}
        </span>
      )}
    >
      {granted ? (
        <Badge
          variant="outline"
          className="border-success/25 bg-success/10 text-success"
        >
          {grantedLabel}
        </Badge>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          disabled={busy || checking}
          onClick={onRequest}
        >
          {busy ? openingLabel : requestLabel}
        </Button>
      )}
    </SettingsRow>
  )
}
