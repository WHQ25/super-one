import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import { Cloud, Monitor, Smartphone, Wifi } from 'lucide-react'
import { Switch } from '@superone/ui/components/ui/switch'
import { Button } from '@superone/ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { cn } from '@superone/ui/lib/utils'
import { useAppStore } from '@/stores/app'
import { useRemoteStatus } from '@/hooks/useRemoteStatus'
import type { PairedDevice } from '@superone/shared/agent-types'
import { EnvironmentsPage } from './settings/environments/EnvironmentsPage'

function deviceClientKind(device: PairedDevice): 'mobile' | 'desktop' {
  return device.clientKind === 'desktop' ? 'desktop' : 'mobile'
}

type PairingStep = 'idle' | 'waiting_scan' | 'waiting_code'
type RemoteSettingsTab = 'this-device' | 'other-devices'

/**
 * Settings → Remote Control.
 *
 * Two product surfaces that used to be separate:
 * - This computer: phone/LAN remote control of the local SuperOne host
 * - Other devices: remote execution environments (SSH / future desktop & Tailscale)
 */
export function RemotePage() {
  const { t } = useTranslation()
  const platform = typeof window !== 'undefined' ? window.app.platform : 'unknown'
  const experimentalRemoteNodesEnabled = useAppStore((s) => s.experimentalRemoteNodesEnabled)
  const thisDeviceLabel =
    platform === 'darwin'
      ? t('settings.remote.tabs.thisMac')
      : t('settings.remote.tabs.thisComputer')
  const [tab, setTab] = useState<RemoteSettingsTab>('this-device')

  // Other Devices (remote node environments) is experimental — force this-host tab when off.
  const activeTab: RemoteSettingsTab =
    experimentalRemoteNodesEnabled && tab === 'other-devices' ? 'other-devices' : 'this-device'

  useEffect(() => {
    if (!experimentalRemoteNodesEnabled && tab === 'other-devices') {
      setTab('this-device')
    }
  }, [experimentalRemoteNodesEnabled, tab])

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t('settings.remote.pageTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.remote.pageSubtitle')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <button
          type="button"
          onClick={() => setTab('this-device')}
          className={cn(
            'text-sm transition-colors',
            activeTab === 'this-device'
              ? 'font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {thisDeviceLabel}
        </button>
        {experimentalRemoteNodesEnabled ? (
          <button
            type="button"
            onClick={() => setTab('other-devices')}
            className={cn(
              'text-sm transition-colors',
              activeTab === 'other-devices'
                ? 'font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('settings.remote.tabs.otherDevices')}
          </button>
        ) : null}
      </div>

      {activeTab === 'this-device' ? <ThisDevicePanel /> : <EnvironmentsPage />}
    </div>
  )
}

/** Former Remote Control page body — pair phones / control this host. */
function ThisDevicePanel() {
  const { t } = useTranslation()
  const config = useAppStore((s) => s.remoteConfig)
  const setRemoteConfig = useAppStore((s) => s.setRemoteConfig)
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([])
  const [pairingStep, setPairingStep] = useState<PairingStep>('idle')
  const [qrValue, setQrValue] = useState('')
  const [pendingDeviceName, setPendingDeviceName] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [codeError, setCodeError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [relayStatus, setRelayStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle')
  const remoteStatus = useRemoteStatus()

  useEffect(() => {
    window.app.listPairedDevices().then(setPairedDevices)

    const unsubStatus = window.app.onDeviceStatusChanged(({ id, online, transport }) => {
      setPairedDevices((prev) => {
        const exists = prev.some((d) => d.id === id)
        if (online && !exists) {
          window.app.listPairedDevices().then(setPairedDevices)
          return prev
        }
        return prev.map((d) =>
          d.id === id ? { ...d, online, transport: online ? transport : undefined } : d,
        )
      })
    })

    const unsubCode = window.app.onPairingCodeReceived(({ deviceName }) => {
      setPendingDeviceName(deviceName)
      setPairingStep('waiting_code')
    })

    const unsubExpired = window.app.onPairingExpired(() => {
      setPairingStep('idle')
      setQrValue('')
      setCodeInput('')
      setCodeError(t('resources.remote.sessionExpired'))
    })

    const unsubAlreadyPaired = window.app.onPairingAlreadyPaired(({ deviceName }) => {
      setPairingStep('idle')
      setQrValue('')
      toast.warning(t('resources.remote.alreadyPaired', { name: deviceName }))
    })

    return () => {
      unsubStatus()
      unsubCode()
      unsubExpired()
      unsubAlreadyPaired()
    }
  }, [t])

  async function handleStartPairing() {
    setCodeError('')

    const { channelId, tempKeyHex, relayUrl } = await window.app.startPairing()
    const url = `superone://pair?channel=${channelId}&key=${tempKeyHex}&deviceId=${config!.deviceId}&relay=${encodeURIComponent(relayUrl)}`
    setQrValue(url)
    setPairingStep('waiting_scan')
  }

  async function handleConfirmPairing() {
    if (codeInput.length !== 6) {
      setCodeError(t('resources.remote.stepCode'))
      return
    }
    setConfirming(true)
    setCodeError('')
    try {
      await window.app.confirmPairing(codeInput)
      await window.app.listPairedDevices().then(setPairedDevices)
      setPairingStep('idle')
      setQrValue('')
      setCodeInput('')
    } catch {
      setCodeError(t('resources.remote.codeError'))
    }
    setConfirming(false)
  }

  async function handleCancelPairing() {
    await window.app.cancelPairing()
    setPairingStep('idle')
    setQrValue('')
    setCodeInput('')
    setCodeError('')
  }

  function updateConfig(patch: Partial<NonNullable<typeof config>>) {
    if (!config) return
    setRemoteConfig({ ...config, ...patch })
  }

  async function handleRemoveDevice(id: string) {
    await window.app.removePairedDevice(id)
    setPairedDevices((prev) => prev.filter((d) => d.id !== id))
  }

  async function checkRelay() {
    const url = config?.relayUrl
    if (!url) return
    setRelayStatus('checking')
    try {
      const httpUrl = url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
      const res = await fetch(`${httpUrl}/health`)
      setRelayStatus(res.ok ? 'ok' : 'error')
    } catch {
      setRelayStatus('error')
    }
  }

  const mobileDevices = pairedDevices.filter((d) => deviceClientKind(d) === 'mobile')
  const desktopDevices = pairedDevices.filter((d) => deviceClientKind(d) === 'desktop')

  return (
    <div className="space-y-6">
      <TooltipProvider delayDuration={200}>
        <div className="flex w-full items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <Monitor className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono text-foreground">{remoteStatus.hostname || '—'}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center">
                  <Cloud
                    className={cn(
                      'size-3.5',
                      remoteStatus.relayConnected ? 'text-success' : 'text-muted-foreground/40',
                    )}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t('resources.remote.statusRelay')}:{' '}
                {remoteStatus.relayConnected
                  ? t('resources.remote.statusRelayConnected')
                  : t('resources.remote.statusRelayDisconnected')}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center">
                  <Wifi
                    className={cn(
                      'size-3.5',
                      remoteStatus.lanActive ? 'text-success' : 'text-muted-foreground/40',
                    )}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t('resources.remote.statusLan')}:{' '}
                {remoteStatus.lanActive
                  ? t('resources.remote.statusLanActive')
                  : t('resources.remote.statusLanInactive')}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>

      <div className="space-y-4 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{t('resources.remote.enableLabel')}</p>
            <p className="text-xs text-muted-foreground">{t('resources.remote.enableDescription')}</p>
          </div>
          <Switch
            checked={config?.enabled ?? false}
            onCheckedChange={(checked) => updateConfig({ enabled: checked })}
          />
        </div>
      </div>

      <div className="grid gap-4">
        {/* Mobile controllers */}
        <section className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Smartphone className="size-4 shrink-0 text-muted-foreground" />
              <p className="text-sm font-medium">{t('settings.remote.thisDevice.mobile.title')}</p>
            </div>
            {pairingStep === 'idle' && (
              <Button
                variant="outline"
                size="sm"
                disabled={!config?.enabled}
                onClick={handleStartPairing}
              >
                {t('resources.remote.pairNewPhone')}
              </Button>
            )}
          </div>

          {config?.enabled && pairingStep === 'waiting_scan' && (
            <div className="flex flex-col items-center space-y-3 border-t border-border pt-4 text-center">
              <p className="text-sm font-semibold">{t('resources.remote.pairTitle')}</p>
              <ol className="list-inside list-decimal space-y-1 text-xs text-muted-foreground">
                <li>{t('resources.remote.stepScan')}</li>
                <li>{t('resources.remote.stepCode')}</li>
              </ol>
              <div className="rounded-lg border border-border bg-white p-3">
                <QRCodeSVG value={qrValue} size={200} />
              </div>
              <div className="flex items-center gap-2">
                {import.meta.env.DEV && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(qrValue)
                      toast.success(t('resources.remote.linkCopied'))
                    }}
                  >
                    {t('resources.remote.copyLink')}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={handleCancelPairing}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          )}

          {config?.enabled && pairingStep === 'waiting_code' && (
            <div className="flex flex-col items-center space-y-3 border-t border-border pt-4 text-center">
              <p className="text-sm font-medium">
                {t('resources.remote.codePrompt')}{' '}
                <span className="text-foreground">{pendingDeviceName}</span>
              </p>
              <div className="flex items-center justify-center gap-2">
                <input
                  className="w-40 rounded-md border border-border bg-background px-3 py-2 text-center font-mono text-lg tracking-widest focus:outline-none focus:ring-1 focus:ring-ring"
                  maxLength={6}
                  value={codeInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setCodeInput(e.target.value.replace(/\D/g, ''))
                  }
                  placeholder="000000"
                  autoFocus
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) =>
                    e.key === 'Enter' && handleConfirmPairing()
                  }
                />
                <Button
                  onClick={handleConfirmPairing}
                  disabled={confirming || codeInput.length !== 6}
                >
                  {confirming ? t('resources.remote.confirming') : t('resources.remote.confirm')}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleCancelPairing}>
                  {t('common.cancel')}
                </Button>
              </div>
              {codeError && <p className="text-xs text-destructive">{codeError}</p>}
            </div>
          )}

          {codeError && pairingStep === 'idle' && (
            <p className="text-xs text-destructive">{codeError}</p>
          )}

          {mobileDevices.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('settings.remote.thisDevice.mobile.empty')}
            </p>
          ) : (
            <ul className="space-y-2">
              {mobileDevices.map((device) => (
                <PairedDeviceRow
                  key={device.id}
                  device={device}
                  onRemove={() => handleRemoveDevice(device.id)}
                />
              ))}
            </ul>
          )}
        </section>

        {/* Desktop controllers of this host */}
        <section className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Monitor className="size-4 shrink-0 text-muted-foreground" />
              <p className="text-sm font-medium">{t('settings.remote.thisDevice.desktop.title')}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled
              title={t('resources.remote.pairNewDesktop')}
            >
              {t('resources.remote.pairNewDesktop')}
            </Button>
          </div>

          {desktopDevices.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('settings.remote.thisDevice.desktop.empty')}
            </p>
          ) : (
            <ul className="space-y-2">
              {desktopDevices.map((device) => (
                <PairedDeviceRow
                  key={device.id}
                  device={device}
                  onRemove={() => handleRemoveDevice(device.id)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      {import.meta.env.DEV && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{t('resources.remote.customRelay')}</p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                window.open(
                  'https://deploy.workers.cloudflare.com/?url=https://github.com/WHQ25/super-one-relay',
                  '_blank',
                )
              }
            >
              {t('resources.remote.deployCloudflare')}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="wss://your-relay.workers.dev"
              value={config?.relayUrl ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                updateConfig({ relayUrl: e.target.value.trim() })
                setRelayStatus('idle')
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={checkRelay}
              disabled={!config?.relayUrl || relayStatus === 'checking'}
            >
              {relayStatus === 'checking'
                ? t('resources.remote.checking')
                : t('resources.remote.test')}
            </Button>
            {relayStatus === 'ok' && (
              <span className="text-xs text-success">{t('resources.remote.relayConnected')}</span>
            )}
            {relayStatus === 'error' && (
              <span className="text-xs text-destructive">
                {t('resources.remote.relayUnreachable')}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('resources.remote.relayHint')}</p>
        </div>
      )}
    </div>
  )
}

function PairedDeviceRow({
  device,
  onRemove,
}: {
  device: PairedDevice
  onRemove: () => void
}) {
  const { t } = useTranslation()
  return (
    <li className="flex items-center justify-between rounded-md border border-border/80 bg-background/50 px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'size-2 shrink-0 rounded-full',
            device.online ? 'bg-success' : 'bg-muted-foreground/40',
          )}
        />
        <span className="truncate">{device.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {device.online
            ? t('resources.remote.online')
            : device.lastSeenAt
              ? t('resources.remote.lastSeen', {
                  date: new Date(device.lastSeenAt).toLocaleDateString(),
                })
              : t('resources.remote.neverConnected')}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 text-xs text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        {t('resources.remote.remove')}
      </Button>
    </li>
  )
}
