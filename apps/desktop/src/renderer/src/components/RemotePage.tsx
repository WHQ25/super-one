import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import { Monitor, Cloud, Wifi } from 'lucide-react'
import { Switch } from '@superone/ui/components/ui/switch'
import { Button } from '@superone/ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { cn } from '@superone/ui/lib/utils'
import { useAppStore } from '@/stores/app'
import { useRemoteStatus } from '@/hooks/useRemoteStatus'
import type { PairedDevice } from '@superone/shared/agent-types'

type PairingStep = 'idle' | 'waiting_scan' | 'waiting_code'

export function RemotePage() {
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
        return prev.map((d) => d.id === id ? { ...d, online, transport: online ? transport : undefined } : d)
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
  }, [])

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

  function updateConfig(patch: Partial<typeof config>) {
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t('resources.remote.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('resources.remote.subtitle')}
        </p>
      </div>

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
                  <Cloud className={cn('size-3.5', remoteStatus.relayConnected ? 'text-green-500' : 'text-muted-foreground/40')} />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t('resources.remote.statusRelay')}: {remoteStatus.relayConnected ? t('resources.remote.statusRelayConnected') : t('resources.remote.statusRelayDisconnected')}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center">
                  <Wifi className={cn('size-3.5', remoteStatus.lanActive ? 'text-green-500' : 'text-muted-foreground/40')} />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t('resources.remote.statusLan')}: {remoteStatus.lanActive ? t('resources.remote.statusLanActive') : t('resources.remote.statusLanInactive')}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>

      <div className="rounded-lg border border-border p-4 space-y-4">
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

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{t('resources.remote.preventSleepLabel')}</p>
            <p className="text-xs text-muted-foreground">{t('resources.remote.preventSleepDescription')}</p>
          </div>
          <Switch
            checked={config?.preventSleep ?? false}
            onCheckedChange={(checked) => updateConfig({ preventSleep: checked })}
          />
        </div>
      </div>

      {config?.enabled && (
        <div className="rounded-lg border border-border p-4 space-y-4">
          {pairingStep === 'idle' && (
            <Button variant="outline" size="sm" onClick={handleStartPairing}>
              {t('resources.remote.pairNewDevice')}
            </Button>
          )}

          {pairingStep === 'waiting_scan' && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">{t('resources.remote.pairTitle')}</p>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>{t('resources.remote.stepScan')}</li>
                <li>{t('resources.remote.stepCode')}</li>
              </ol>
              <div className="rounded-lg border border-border bg-white p-3 w-fit">
                <QRCodeSVG value={qrValue} size={200} />
              </div>
              {import.meta.env.DEV && (
                <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(qrValue); toast.success(t('resources.remote.linkCopied')) }}>
                  {t('resources.remote.copyLink')}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={handleCancelPairing}>
                {t('common.cancel')}
              </Button>
            </div>
          )}

          {pairingStep === 'waiting_code' && (
            <div className="space-y-3">
              <p className="text-sm font-medium">
                {t('resources.remote.codePrompt')} <span className="text-foreground">{pendingDeviceName}</span>
              </p>
              <div className="flex items-center gap-2">
                <input
                  className="w-40 font-mono text-lg tracking-widest text-center rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
                  maxLength={6}
                  value={codeInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCodeInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  autoFocus
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleConfirmPairing()}
                />
                <Button onClick={handleConfirmPairing} disabled={confirming || codeInput.length !== 6}>
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
        </div>
      )}

      <div className="rounded-lg border border-border p-4">
        <p className="text-sm font-medium mb-3">{t('resources.remote.paired')}</p>
        {pairedDevices.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('resources.remote.noPaired')}</p>
        ) : (
          <ul className="space-y-2">
            {pairedDevices.map((device) => (
              <li key={device.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className={cn('size-2 rounded-full', device.online ? 'bg-green-500' : 'bg-muted-foreground/40')} />
                  <span>{device.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {device.online ? t('resources.remote.online') : device.lastSeenAt ? t('resources.remote.lastSeen', { date: new Date(device.lastSeenAt).toLocaleDateString() }) : t('resources.remote.neverConnected')}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemoveDevice(device.id)}
                >
                  {t('resources.remote.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {import.meta.env.DEV && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{t('resources.remote.customRelay')}</p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => window.open('https://deploy.workers.cloudflare.com/?url=https://github.com/WHQ25/super-one-relay', '_blank')}
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
              {relayStatus === 'checking' ? t('resources.remote.checking') : t('resources.remote.test')}
            </Button>
            {relayStatus === 'ok' && <span className="text-xs text-green-600">{t('resources.remote.relayConnected')}</span>}
            {relayStatus === 'error' && <span className="text-xs text-destructive">{t('resources.remote.relayUnreachable')}</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('resources.remote.relayHint')}
          </p>
        </div>
      )}
    </div>
  )
}
