import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowUpCircle,
  FlaskConical,
  Loader2,
  Monitor,
  Network,
  Plug,
  Plus,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
  Unplug,
} from 'lucide-react'
import {
  canRepairOverSsh as canRepairOverSshShared,
  type EnvironmentInstallProgress,
  type EnvironmentListItem,
  type EndpointKind,
  type SupervisorState,
} from '@superone/shared/environment'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import {
  enabledRemoteChannels,
  type RemoteDeviceChannel,
} from '@/lib/remote-channel-flags'
import { AddEnvironmentDialog } from './AddEnvironmentDialog'

/** Supervisor states that mean "a socket is live right now". */
const LIVE_STATES: SupervisorState[] = ['connected', 'synchronizing']

/** Loopback HTTP(S)/WS targets — local remote-node lab, not LAN mesh. */
export function isLoopbackEnvironment(item: EnvironmentListItem): boolean {
  if (item.kind === 'local') return false
  const preferred =
    item.endpointProfiles.find((p) => p.endpointId === item.preferredEndpointId) ??
    item.endpointProfiles[0]
  const target = preferred?.target
  if (!target?.trim()) return false
  try {
    const raw = target.trim()
    const url = raw.includes('://') ? new URL(raw) : new URL(`http://${raw}`)
    const host = url.hostname.replace(/^\[|\]$/g, '')
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return /^(https?|wss?):\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(target)
  }
}

/** Map a remote environment to the connection-channel card it belongs on. */
export function channelForEnvironment(item: EnvironmentListItem): RemoteDeviceChannel | null {
  if (item.kind === 'local') return null
  // Local lab pairs as direct-wss on loopback; keep them out of the disabled desktop card.
  if (isLoopbackEnvironment(item)) return null
  const preferred =
    item.endpointProfiles.find((p) => p.endpointId === item.preferredEndpointId) ??
    item.endpointProfiles[0]
  const kind: EndpointKind | undefined = preferred?.kind
  if (kind === 'ssh-forward') return 'ssh'
  if (kind === 'tailscale') return 'tailscale'
  // Peer SuperOne desktops / direct mesh land on the desktop card.
  if (kind === 'direct-wss' || kind === 'relay') return 'desktop'
  return 'desktop'
}

/**
 * True when automated SSH repair may run. Aligns with
 * {@link selectSshRepairProfile}: preferred non-SSH endpoints do not auto-probe
 * a stale SSH backup — those fall through to manual token paste.
 */
export function canRepairOverSsh(item: EnvironmentListItem): boolean {
  return canRepairOverSshShared(item)
}

const CHANNEL_META: Record<
  RemoteDeviceChannel,
  { icon: typeof Monitor; titleKey: string }
> = {
  desktop: {
    icon: Monitor,
    titleKey: 'settings.remote.channels.desktop.title',
  },
  ssh: {
    icon: Terminal,
    titleKey: 'settings.remote.channels.ssh.title',
  },
  tailscale: {
    icon: Network,
    titleKey: 'settings.remote.channels.tailscale.title',
  },
}

/**
 * "Control other devices" panel: one card per connection channel (Desktop / SSH /
 * Tailscale). Only channels with REMOTE_CHANNEL_ENABLED are shown.
 * Card chrome matches Control This Mac (Mobile / Desktop) cards.
 */
export function EnvironmentsPage() {
  const { t } = useTranslation()
  const [items, setItems] = useState<EnvironmentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  /** Latest repair/upgrade progress for the row currently marked busy. */
  const [busyProgress, setBusyProgress] = useState<EnvironmentInstallProgress | null>(null)
  /** Ref mirrors busyId so progress events and begin/endBusy stay race-free. */
  const busyIdRef = useRef<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const channels = useMemo(() => enabledRemoteChannels(), [])
  const showLocalLab = import.meta.env.DEV
  const anyBusy = busyId != null

  const refresh = useCallback(async () => {
    try {
      setItems(await window.environment.listItems())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    return window.environment.onStatusEvent(() => void refresh())
  }, [refresh])

  useEffect(() => {
    return window.environment.onInstallProgress((progress) => {
      // Only drive the device row for upgrade/repair of a known connectionId.
      if (
        (progress.operation === 'repair' || progress.operation === 'upgrade') &&
        progress.connectionId &&
        progress.connectionId === busyIdRef.current
      ) {
        setBusyProgress(progress)
      }
    })
  }, [])

  const labItems = useMemo(
    () => items.filter((item) => item.kind === 'remote' && isLoopbackEnvironment(item)),
    [items],
  )

  const byChannel = useMemo(() => {
    const map: Record<RemoteDeviceChannel, EnvironmentListItem[]> = {
      desktop: [],
      ssh: [],
      tailscale: [],
    }
    for (const item of items) {
      const channel = channelForEnvironment(item)
      if (channel) map[channel].push(item)
    }
    return map
  }, [items])

  /** Global single-flight: one environment operation at a time across all rows. */
  function beginBusy(connectionId: string): boolean {
    if (busyIdRef.current) return false
    busyIdRef.current = connectionId
    setBusyId(connectionId)
    setBusyProgress(null)
    return true
  }

  function endBusy(connectionId: string): void {
    if (busyIdRef.current !== connectionId) return
    busyIdRef.current = null
    setBusyId(null)
    setBusyProgress(null)
  }

  async function run(connectionId: string, action: () => Promise<unknown>): Promise<void> {
    if (!beginBusy(connectionId)) {
      toast.error(
        t('settings.environments.operationInProgress', {
          defaultValue: 'Another environment operation is already in progress',
        }),
      )
      return
    }
    try {
      await action()
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      endBusy(connectionId)
    }
  }

  function handleForget(item: EnvironmentListItem): void {
    if (!window.confirm(t('settings.environments.forgetConfirm', { label: item.label }))) return
    void run(item.connectionId, () => window.environment.forget(item.connectionId))
  }

  function handleUpgrade(item: EnvironmentListItem): void {
    void run(item.connectionId, async () => {
      const result = await window.environment.upgradeNode(item.connectionId)
      toast.success(t('settings.environments.upgradeNodeSuccess', { version: result.version }))
      for (const w of result.warnings) toast.warning(w)
    })
  }

  function promptManualRepair(item: EnvironmentListItem): void {
    const token = window.prompt(
      t('settings.environments.repairTokenPrompt', {
        defaultValue: 'Paste a fresh pairing token from the node',
      }),
    )
    if (!token?.trim()) return
    const base =
      item.endpointProfiles.find((p) => p.endpointId === item.preferredEndpointId)?.target ||
      item.endpointProfiles[0]?.target ||
      ''
    const baseUrl = window.prompt(
      t('settings.environments.repairBaseUrlPrompt', {
        defaultValue: 'Node base URL (http://host:port)',
      }),
      base.startsWith('http') ? base : '',
    )
    if (!baseUrl?.trim()) return
    void run(item.connectionId, async () => {
      await window.environment.repairPairing({
        connectionId: item.connectionId,
        baseUrl: baseUrl.trim(),
        pairingToken: token.trim(),
      })
      toast.success(
        t('settings.environments.repairPairingSuccess', {
          defaultValue: 'Pairing repaired',
        }),
      )
    })
  }

  function handleRepair(item: EnvironmentListItem): void {
    // SSH-reachable hosts: mint the token on the host and keep connectionId.
    // On failure, fall back to manual paste so a stale SSH backup never bricks recovery.
    if (!canRepairOverSsh(item)) {
      promptManualRepair(item)
      return
    }
    if (!beginBusy(item.connectionId)) {
      toast.error(
        t('settings.environments.operationInProgress', {
          defaultValue: 'Another environment operation is already in progress',
        }),
      )
      return
    }
    void (async () => {
      let failed = false
      try {
        await window.environment.repairPairingOverSsh(item.connectionId)
        toast.success(
          t('settings.environments.repairPairingSuccess', {
            defaultValue: 'Pairing repaired',
          }),
        )
        await refresh()
      } catch (err) {
        failed = true
        const message = err instanceof Error ? err.message : String(err)
        toast.error(
          t('settings.environments.repairPairingSshFailed', {
            defaultValue:
              'Automatic SSH repair failed: {{message}}. Falling back to manual repair.',
            message,
          }),
        )
      } finally {
        endBusy(item.connectionId)
      }
      // Prompts after busy is cleared so they do not race a second run()'s spinner.
      if (failed) promptManualRepair(item)
    })()
  }

  function handleAdded(warnings: string[]): void {
    toast.success(t('settings.environments.addSuccess'))
    for (const w of warnings) toast.warning(w)
    void refresh()
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-4">
          {showLocalLab && (
            <LocalLabSection
              devices={labItems}
              busyId={busyId}
              anyBusy={anyBusy}
              onBeginBusy={beginBusy}
              onEndBusy={endBusy}
              onRefreshList={() => void refresh()}
              onConnect={(id) =>
                void run(id, () => window.environment.connect(id))
              }
              onDisconnect={(id) =>
                void run(id, () => window.environment.disconnect(id))
              }
              onForget={handleForget}
              onUpgrade={handleUpgrade}
            />
          )}

          {channels.map((channel) => {
            const meta = CHANNEL_META[channel]
            const Icon = meta.icon
            const devices = byChannel[channel]
            return (
              <section key={channel} className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <p className="text-sm font-medium">{t(meta.titleKey)}</p>
                  </div>
                  {channel === 'ssh' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAddOpen(true)}
                      disabled={anyBusy}
                    >
                      <Plus className="size-4" />
                      {t('settings.remote.channels.addDevice')}
                    </Button>
                  )}
                </div>

                {devices.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t('settings.remote.channels.empty')}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {devices.map((item) => (
                      <li key={item.connectionId}>
                        <EnvironmentDeviceRow
                          item={item}
                          busy={busyId === item.connectionId}
                          actionsLocked={anyBusy && busyId !== item.connectionId}
                          onConnect={() =>
                            void run(item.connectionId, () =>
                              window.environment.connect(item.connectionId),
                            )
                          }
                          onDisconnect={() =>
                            void run(item.connectionId, () =>
                              window.environment.disconnect(item.connectionId),
                            )
                          }
                          onForget={() => handleForget(item)}
                          onUpgrade={() => handleUpgrade(item)}
                          onRetry={() =>
                            void run(item.connectionId, async () => {
                              const d = await window.environment.retryNow(item.connectionId)
                              if (d === 'blocked') {
                                toast.error(
                                  t('settings.environments.retryBlocked', {
                                    defaultValue: 'Connection is blocked — re-pair required',
                                  }),
                                )
                              }
                            })
                          }
                          onRepair={() => handleRepair(item)}
                          busyProgress={
                            busyId === item.connectionId ? busyProgress : null
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}

      <AddEnvironmentDialog open={addOpen} onOpenChange={setAddOpen} onAdded={handleAdded} />
    </div>
  )
}

interface LocalLabStatusView {
  available: boolean
  baseUrl: string
  label: string
  nodeHome: string
  reachable: boolean
  environmentId?: string
  error?: string
  startHint: string
}

interface LocalLabSectionProps {
  devices: EnvironmentListItem[]
  busyId: string | null
  anyBusy: boolean
  onBeginBusy: (id: string) => boolean
  onEndBusy: (id: string) => void
  onRefreshList: () => void
  onConnect: (connectionId: string) => void
  onDisconnect: (connectionId: string) => void
  onForget: (item: EnvironmentListItem) => void
  onUpgrade: (item: EnvironmentListItem) => void
}

/** Dev-only card: one-click pair to host-process lab on loopback. */
function LocalLabSection({
  devices,
  busyId,
  anyBusy,
  onBeginBusy,
  onEndBusy,
  onRefreshList,
  onConnect,
  onDisconnect,
  onForget,
  onUpgrade,
}: LocalLabSectionProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<LocalLabStatusView | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [pairing, setPairing] = useState(false)

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      setStatus(await window.environment.localLabStatus())
    } catch (err) {
      setStatus({
        available: false,
        baseUrl: 'http://127.0.0.1:7789',
        label: 'local-dev-lab',
        nodeHome: '',
        reachable: false,
        error: err instanceof Error ? err.message : String(err),
        startHint: 'bun run dev:cli:lab',
      })
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  async function handlePair(): Promise<void> {
    if (!onBeginBusy('__local_lab__')) {
      toast.error(
        t('settings.environments.operationInProgress', {
          defaultValue: 'Another environment operation is already in progress',
        }),
      )
      return
    }
    setPairing(true)
    try {
      const result = await window.environment.pairLocalLab()
      toast.success(
        result.alreadyPaired
          ? t('settings.remote.channels.localLab.connectSuccessExisting')
          : t('settings.remote.channels.localLab.connectSuccess'),
      )
      onRefreshList()
      await refreshStatus()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      await refreshStatus()
    } finally {
      setPairing(false)
      onEndBusy('__local_lab__')
    }
  }

  const reachable = status?.reachable === true
  const busy = pairing || busyId === '__local_lab__'

  return (
    <section className="space-y-3 rounded-lg border border-dashed border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <FlaskConical className="size-4 shrink-0 text-muted-foreground" />
            <p className="text-sm font-medium">{t('settings.remote.channels.localLab.title')}</p>
            {!statusLoading && status && (
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                  reachable
                    ? 'bg-success/15 text-success'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {reachable
                  ? t('settings.remote.channels.localLab.online')
                  : t('settings.remote.channels.localLab.offline')}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('settings.remote.channels.localLab.description')}
          </p>
          {status && (
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {status.baseUrl}
              {status.environmentId ? ` · ${status.environmentId.slice(0, 8)}…` : ''}
            </p>
          )}
          {!reachable && status && (
            <p className="text-xs text-muted-foreground">
              {t('settings.remote.channels.localLab.startHint', { cmd: status.startHint })}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            disabled={statusLoading || busy}
            onClick={() => void refreshStatus()}
            title={t('settings.remote.channels.localLab.refreshStatus')}
          >
            {statusLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || statusLoading || (anyBusy && !busy)}
            onClick={() => void handlePair()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
            {devices.length > 0
              ? t('settings.remote.channels.localLab.reconnect')
              : t('settings.remote.channels.localLab.connect')}
          </Button>
        </div>
      </div>

      {devices.length > 0 && (
        <ul className="space-y-2">
          {devices.map((item) => (
            <li key={item.connectionId}>
              <EnvironmentDeviceRow
                item={item}
                busy={busyId === item.connectionId}
                actionsLocked={anyBusy && busyId !== item.connectionId}
                onConnect={() => onConnect(item.connectionId)}
                onDisconnect={() => onDisconnect(item.connectionId)}
                onForget={() => onForget(item)}
                onUpgrade={() => onUpgrade(item)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

interface EnvironmentDeviceRowProps {
  item: EnvironmentListItem
  busy: boolean
  /** Another row owns the global environment operation — hide action buttons. */
  actionsLocked?: boolean
  busyProgress?: EnvironmentInstallProgress | null
  onConnect: () => void
  onDisconnect: () => void
  onForget: () => void
  onUpgrade: () => void
  onRetry?: () => void
  onRepair?: () => void
}

/** Compact row aligned with paired phone/desktop rows on Control This Mac. */
function EnvironmentDeviceRow({
  item,
  busy,
  actionsLocked = false,
  busyProgress,
  onConnect,
  onDisconnect,
  onForget,
  onUpgrade,
  onRetry,
  onRepair,
}: EnvironmentDeviceRowProps) {
  const { t } = useTranslation()
  const live = LIVE_STATES.includes(item.state)
  const blocked = item.state === 'blocked'
  const authBlocked = blocked && (item.blockReason === 'auth' || item.blockReason === 'revoked')
  // Trust boundary: Connect cannot clear this, and existing repair refuses a
  // changed fingerprint. Only Forget (then re-add) is an honest recovery path.
  const identityConflict = blocked && item.blockReason === 'identity_conflict'
  const subtitle =
    item.endpointProfiles[0]?.target ||
    item.endpointProfiles[0]?.label ||
    (item.platform ? `${item.platform.os}/${item.platform.arch}` : null)
  const busyLabel =
    busy && busyProgress
      ? busyProgress.phase === 'installing'
        ? busyProgress.step
        : busyProgress.phase
      : null
  const controlsDisabled = busy || actionsLocked

  return (
    <div className="rounded-md border border-border/80 bg-background/50 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Server
            className={cn(
              'size-3.5 shrink-0',
              live ? 'text-success' : blocked ? 'text-destructive' : 'text-muted-foreground',
            )}
          />
          <span className="truncate text-sm font-medium">{item.label}</span>
          {subtitle ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">{subtitle}</span>
          ) : null}
          {identityConflict ? (
            <span className="shrink-0 text-xs text-destructive">
              {t('settings.environments.identityConflict', {
                defaultValue: 'Identity mismatch — forget and re-add',
              })}
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {busy ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {busyLabel ? <span className="capitalize">{busyLabel}</span> : null}
            </span>
          ) : actionsLocked ? null : live ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={onDisconnect}
            >
              <Unplug className="size-3.5" />
              {t('settings.environments.disconnect')}
            </Button>
          ) : authBlocked && onRepair ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={onRepair}
            >
              <RefreshCw className="size-3.5" />
              {t('settings.environments.repairPairing', { defaultValue: 'Repair pairing' })}
            </Button>
          ) : identityConflict ? null : (
            <>
              {item.state === 'backoff' && onRetry ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={onRetry}
                >
                  <RefreshCw className="size-3.5" />
                  {t('settings.environments.retryNow', { defaultValue: 'Retry' })}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={onConnect}
              >
                <Plug className="size-3.5" />
                {t('settings.environments.connect')}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-destructive"
            onClick={onForget}
            disabled={controlsDisabled}
          >
            <Trash2 className="size-3.5" />
            {t('settings.environments.forget')}
          </Button>
        </div>
      </div>

      {item.lastError && (
        <p
          className={cn(
            'mt-1.5 text-xs break-words',
            item.state === 'blocked' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {item.blockReason
            ? t(`settings.environments.blockReason.${item.blockReason}`, {
                defaultValue: item.blockReason,
              })
            : null}
          {item.blockReason ? ' — ' : ''}
          {item.lastError}
        </p>
      )}

      {item.credentialInMemoryOnly && (
        <p className="mt-1.5 text-xs text-destructive">
          {t('settings.environments.credentialInMemoryOnly')}
        </p>
      )}

      {item.nodeUpgrade && (
        <div className="mt-1.5 space-y-1.5">
          <p className="text-xs text-warning">
            {t('settings.environments.nodeOutdated', {
              remoteVersion: item.nodeUpgrade.remoteVersion,
              targetVersion: item.nodeUpgrade.targetVersion,
            })}
          </p>
          {item.nodeUpgrade.canUpgradeOverSsh ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onUpgrade}
              disabled={controlsDisabled}
            >
              <ArrowUpCircle className="size-3.5" />
              {busy
                ? t('settings.environments.upgradingNode')
                : t('settings.environments.upgradeNode')}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('settings.environments.nodeOutdatedManual')}
            </p>
          )}
        </div>
      )}

      {live ? <RemoteHarnessPanel connectionId={item.connectionId} /> : null}
    </div>
  )
}

interface RemoteHarnessRow {
  id: string
  enabled: boolean
  state: string
  runtimeSource: string
  requiresAuth: boolean
  diagnostic?: { code: string; message: string }
}

/** Connected remote only: list + enable/disable harness catalog via node:admin RPC. */
function RemoteHarnessPanel({ connectionId }: { connectionId: string }) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<RemoteHarnessRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const list = (await window.environment.listHarnesses(connectionId)) as RemoteHarnessRow[]
      setRows(Array.isArray(list) ? list : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setRows(null)
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function toggle(row: RemoteHarnessRow): Promise<void> {
    setBusyId(row.id)
    setError('')
    try {
      if (row.enabled && (row.state === 'ready' || row.state === 'needs_auth')) {
        await window.environment.disableHarness(connectionId, row.id)
        toast.success(t('settings.environments.harness.disabled', { id: row.id }))
      } else {
        await window.environment.enableHarness(connectionId, { harnessId: row.id })
        toast.success(t('settings.environments.harness.enabled', { id: row.id }))
      }
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(msg)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {t('settings.environments.harness.title')}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs text-muted-foreground"
          onClick={() => void refresh()}
          disabled={loading || busyId !== null}
        >
          <RefreshCw className={cn('size-3', loading && 'animate-spin')} />
        </Button>
      </div>
      {loading && !rows ? (
        <p className="text-xs text-muted-foreground">{t('settings.environments.harness.loading')}</p>
      ) : null}
      {error ? <p className="text-xs text-destructive break-words">{error}</p> : null}
      {rows && rows.length > 0 ? (
        <ul className="space-y-1">
          {rows.map((row) => {
            const active = row.enabled && (row.state === 'ready' || row.state === 'needs_auth')
            const label = t(`settings.environments.harness.ids.${row.id}`, {
              defaultValue: row.id,
            })
            return (
              <li
                key={row.id}
                className="flex items-center justify-between gap-2 rounded px-1 py-0.5 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{label}</span>
                  <span className="ml-1.5 text-muted-foreground">
                    {row.state}
                    {row.requiresAuth && row.state === 'needs_auth'
                      ? ` · ${t('settings.environments.harness.needsAuth')}`
                      : ''}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 shrink-0 px-2 text-xs"
                  disabled={busyId !== null}
                  onClick={() => void toggle(row)}
                >
                  {busyId === row.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : active ? (
                    t('settings.environments.harness.disable')
                  ) : (
                    t('settings.environments.harness.enable')
                  )}
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
      {rows && rows.length === 0 && !loading ? (
        <p className="text-xs text-muted-foreground">{t('settings.environments.harness.empty')}</p>
      ) : null}
    </div>
  )
}
