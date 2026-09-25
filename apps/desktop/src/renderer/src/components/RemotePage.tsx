import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import { Cloud, Monitor, Wifi } from 'lucide-react'
import { Switch } from '@superone/ui/components/ui/switch'
import { Button } from '@superone/ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { cn } from '@superone/ui/lib/utils'
import { useAppStore } from '@/stores/app'
import { useRemoteStatus } from '@/hooks/useRemoteStatus'
import type { PairedDevice } from '@superone/shared/agent-types'
import { EnvironmentsPage } from './settings/environments/EnvironmentsPage'
import { PairingCodeConfirm } from './PairingCodeConfirm'
import {
  SettingsPage,
  SettingsRow,
  SettingsSection,
  settingsRowClassName,
} from './settings/SettingsSection'
import { SettingsSegmentedControl } from './settings/SettingsSegmentedControl'

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
    <SettingsPage
      title={t('settings.remote.pageTitle')}
      actions={experimentalRemoteNodesEnabled ? (
        <SettingsSegmentedControl
          label={t('settings.remote.pageTitle')}
          value={activeTab}
          onChange={setTab}
          options={[
            { value: 'this-device', label: thisDeviceLabel },
            { value: 'other-devices', label: t('settings.remote.tabs.otherDevices') },
          ]}
        />
      ) : null}
    >
      {activeTab === 'this-device' ? <ThisDevicePanel /> : <EnvironmentsPage />}
    </SettingsPage>
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
      setPendingDeviceName('')
      setCodeError(t('resources.remote.sessionExpired'))
    })

    const unsubAlreadyPaired = window.app.onPairingAlreadyPaired(({ deviceName }) => {
      setPairingStep('idle')
      setQrValue('')
      setCodeInput('')
      setPendingDeviceName('')
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
      await window.app.confirmPairing(codeInput, pendingDeviceName)
      await window.app.listPairedDevices().then(setPairedDevices)
      setPairingStep('idle')
      setQrValue('')
      setCodeInput('')
      setPendingDeviceName('')
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
    setPendingDeviceName('')
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

  const emptyRowClassName = cn(settingsRowClassName, 'text-xs text-muted-foreground')

  return (
    <>
      <SettingsSection>
        <div className={cn(settingsRowClassName, 'flex items-center justify-between gap-4')}>
          <div className="flex min-w-0 items-center gap-2">
            <Monitor className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono text-xs text-foreground">{remoteStatus.hostname || '—'}</span>
          </div>
          <TooltipProvider delayDuration={200}>
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
          </TooltipProvider>
        </div>
        <SettingsRow
          label={t('resources.remote.enableLabel')}
          description={t('resources.remote.enableDescription')}
        >
          <Switch
            checked={config?.enabled ?? false}
            onCheckedChange={(checked) => updateConfig({ enabled: checked })}
          />
        </SettingsRow>
      </SettingsSection>

      {/* Mobile controllers */}
      <SettingsSection
        title={t('settings.remote.thisDevice.mobile.title')}
        actions={pairingStep === 'idle' ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled={!config?.enabled}
            onClick={handleStartPairing}
          >
            {t('resources.remote.pairNewPhone')}
          </Button>
        ) : null}
      >
        {config?.enabled && pairingStep === 'waiting_scan' && (
          <div className={cn(settingsRowClassName, 'flex flex-col items-center gap-3 py-5 text-center')}>
            <p className="text-sm font-medium">{t('resources.remote.pairTitle')}</p>
            <ol className="list-inside list-decimal space-y-1 text-xs text-muted-foreground">
              <li>{t('resources.remote.stepScan')}</li>
              <li>{t('resources.remote.stepCode')}</li>
            </ol>
            {/* The QR code needs a light quiet zone to scan in dark mode too. */}
            <div className="rounded-lg bg-white p-3">
              <QRCodeSVG value={qrValue} size={200} />
            </div>
            <div className="flex items-center gap-2">
              {import.meta.env.DEV && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => {
                    navigator.clipboard.writeText(qrValue)
                    toast.success(t('resources.remote.linkCopied'))
                  }}
                >
                  {t('resources.remote.copyLink')}
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-7" onClick={handleCancelPairing}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}

        {config?.enabled && pairingStep === 'waiting_code' && (
          <div className={settingsRowClassName}>
            <PairingCodeConfirm
              deviceName={pendingDeviceName}
              onDeviceNameChange={setPendingDeviceName}
              code={codeInput}
              onCodeChange={setCodeInput}
              error={codeError}
              confirming={confirming}
              onConfirm={() => { void handleConfirmPairing() }}
              onCancel={() => { void handleCancelPairing() }}
            />
          </div>
        )}

        {codeError && pairingStep === 'idle' && (
          <p className={cn(settingsRowClassName, 'text-xs text-destructive')}>{codeError}</p>
        )}

        {mobileDevices.length === 0 ? (
          <p className={emptyRowClassName}>{t('settings.remote.thisDevice.mobile.empty')}</p>
        ) : (
          <PairedDeviceList devices={mobileDevices} onRemove={handleRemoveDevice} />
        )}
      </SettingsSection>

      {/* Desktop controllers of this host */}
      <SettingsSection
        title={t('settings.remote.thisDevice.desktop.title')}
        actions={(
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled
            title={t('resources.remote.pairNewDesktop')}
          >
            {t('resources.remote.pairNewDesktop')}
          </Button>
        )}
      >
        {desktopDevices.length === 0 ? (
          <p className={emptyRowClassName}>{t('settings.remote.thisDevice.desktop.empty')}</p>
        ) : (
          <PairedDeviceList devices={desktopDevices} onRemove={handleRemoveDevice} />
        )}
      </SettingsSection>

      {import.meta.env.DEV && (
        <SettingsSection
          title={t('resources.remote.customRelay')}
          actions={(
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() =>
                window.open(
                  'https://deploy.workers.cloudflare.com/?url=https://github.com/WHQ25/super-one-relay',
                  '_blank',
                )
              }
            >
              {t('resources.remote.deployCloudflare')}
            </Button>
          )}
        >
          <div className={settingsRowClassName}>
            <div className="flex items-center gap-2">
              <input
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
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
                className="h-7"
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
            <p className="mt-1.5 text-xs text-muted-foreground">{t('resources.remote.relayHint')}</p>
          </div>
        </SettingsSection>
      )}
    </>
  )
}

function PairedDeviceList({
  devices,
  onRemove,
}: {
  devices: PairedDevice[]
  onRemove: (id: string) => void
}) {
  return (
    <ul className="rounded-[inherit]">
      {devices.map((device) => (
        <PairedDeviceRow
          key={device.id}
          device={device}
          onRemove={() => onRemove(device.id)}
        />
      ))}
    </ul>
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
    <li className={cn(settingsRowClassName, 'flex items-center justify-between gap-3 py-2 text-sm')}>
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
        className="h-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        {t('resources.remote.remove')}
      </Button>
    </li>
  )
}
