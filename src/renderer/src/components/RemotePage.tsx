import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import type { PairedDevice } from '../../../shared/agent-types'

type PairingStep = 'idle' | 'waiting_scan' | 'waiting_code'

export function RemotePage() {
  const config = useAppStore((s) => s.remoteConfig)
  const setRemoteConfig = useAppStore((s) => s.setRemoteConfig)
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([])
  const [pairingStep, setPairingStep] = useState<PairingStep>('idle')
  const [qrValue, setQrValue] = useState('')
  const [pendingDeviceName, setPendingDeviceName] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [codeError, setCodeError] = useState('')
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    window.app.listPairedDevices().then(setPairedDevices)

    const unsubStatus = window.app.onDeviceStatusChanged(({ id, online }) => {
      setPairedDevices((prev) => {
        const exists = prev.some((d) => d.id === id)
        if (online && !exists) {
          window.app.listPairedDevices().then(setPairedDevices)
          return prev
        }
        return prev.map((d) => d.id === id ? { ...d, online } : d)
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
      setCodeError('Pairing session expired. Please try again.')
    })

    const unsubAlreadyPaired = window.app.onPairingAlreadyPaired(({ deviceName }) => {
      setPairingStep('idle')
      setQrValue('')
      toast.warning(`${deviceName} is already paired with this device.`)
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

    const { channelId, tempKeyHex } = await window.app.startPairing()
    const url = `superone://pair?channel=${channelId}&key=${tempKeyHex}&deviceId=${config!.deviceId}`
    setQrValue(url)
    setPairingStep('waiting_scan')
  }

  async function handleConfirmPairing() {
    if (codeInput.length !== 6) {
      setCodeError('Please enter the 6-digit code shown on your phone.')
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
      setCodeError('Incorrect code. Please check your phone and try again.')
    } finally {
      setConfirming(false)
    }
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Remote Control</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Allow a mobile device to monitor and control this SuperOne instance.
        </p>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Enable Remote Control</p>
            <p className="text-xs text-muted-foreground">Expose this device for remote pairing</p>
          </div>
          <Switch
            checked={config?.enabled ?? false}
            onCheckedChange={(checked) => updateConfig({ enabled: checked })}
            disabled={!config}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Prevent System Sleep</p>
            <p className="text-xs text-muted-foreground">Prevent idle sleep when the screen is open. Does not apply when the lid is closed.</p>
          </div>
          <Switch
            checked={config?.preventSleep ?? false}
            onCheckedChange={(checked) => updateConfig({ preventSleep: checked })}
            disabled={!config}
          />
        </div>
      </div>

      {config?.enabled && (
        <div className="rounded-lg border border-border p-4 space-y-4">
          {pairingStep === 'idle' && (
            <Button variant="outline" size="sm" onClick={handleStartPairing}>
              Pair New Device
            </Button>
          )}

          {pairingStep === 'waiting_scan' && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Pair a New Device</p>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Open SuperOne on your phone and scan this QR code</li>
                <li>Enter the 6-digit code shown on your phone</li>
              </ol>
              <div className="rounded-lg border border-border bg-white p-3 w-fit">
                <QRCodeSVG value={qrValue} size={200} />
              </div>
              <Button variant="ghost" size="sm" onClick={handleCancelPairing}>
                Cancel
              </Button>
            </div>
          )}

          {pairingStep === 'waiting_code' && (
            <div className="space-y-3">
              <p className="text-sm font-medium">
                Enter the 6-digit code shown on <span className="text-foreground">{pendingDeviceName}</span>
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
                  {confirming ? 'Confirming…' : 'Confirm'}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleCancelPairing}>
                  Cancel
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
        <p className="text-sm font-medium mb-3">Paired Devices</p>
        {pairedDevices.length === 0 ? (
          <p className="text-xs text-muted-foreground">No paired devices.</p>
        ) : (
          <ul className="space-y-2">
            {pairedDevices.map((device) => (
              <li key={device.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className={cn('size-2 rounded-full', device.online ? 'bg-green-500' : 'bg-muted-foreground/40')} />
                  <span>{device.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {device.online ? 'Online' : device.lastSeenAt ? `Last seen ${new Date(device.lastSeenAt).toLocaleDateString()}` : 'Never connected'}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemoveDevice(device.id)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
