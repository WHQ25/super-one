import type { ChangeEvent, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { Label } from '@superone/ui/components/ui/label'

export const PAIRED_DEVICE_NAME_MAX = 64

export function PairingCodeConfirm(props: {
  deviceName: string
  onDeviceNameChange: (value: string) => void
  code: string
  onCodeChange: (value: string) => void
  error: string
  confirming: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-stretch gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="pairing-device-name" className="text-xs text-muted-foreground">
          {t('resources.remote.deviceNameLabel')}
        </Label>
        <Input
          id="pairing-device-name"
          value={props.deviceName}
          maxLength={PAIRED_DEVICE_NAME_MAX}
          onChange={(event) => props.onDeviceNameChange(event.target.value)}
          placeholder={t('resources.remote.deviceNameLabel')}
          className="h-8 bg-background"
        />
        <p className="text-xs text-muted-foreground">{t('resources.remote.deviceNameHint')}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pairing-code" className="text-xs text-muted-foreground">
          {t('resources.remote.stepCode')}
        </Label>
        <div className="flex items-center gap-2">
          <input
            id="pairing-code"
            className="w-40 rounded-md border border-border bg-background px-3 py-2 text-center font-mono text-lg tracking-widest focus:outline-none focus:ring-1 focus:ring-ring"
            maxLength={6}
            value={props.code}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              props.onCodeChange(event.target.value.replace(/\D/g, ''))
            }
            placeholder="000000"
            autoFocus
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) =>
              event.key === 'Enter' && props.onConfirm()
            }
          />
          <Button
            size="sm"
            onClick={props.onConfirm}
            disabled={props.confirming || props.code.length !== 6}
          >
            {props.confirming ? t('resources.remote.confirming') : t('resources.remote.confirm')}
          </Button>
          <Button variant="ghost" size="sm" onClick={props.onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
      {props.error ? <p className="text-xs text-destructive">{props.error}</p> : null}
    </div>
  )
}
