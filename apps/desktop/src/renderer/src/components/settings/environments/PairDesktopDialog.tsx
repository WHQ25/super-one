import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Loader2 } from 'lucide-react'
import type { NodePairingEvent } from '@superone/shared/agent-types'
import { Button } from '@superone/ui/components/ui/button'
import { DialogFooter } from '@superone/ui/components/ui/dialog'
import { PairingDialog } from '../../PairingDialog'
import { PairingQrPanel } from '../../PairingQrPanel'
import { classifyPairDesktopError } from './pair-desktop-error'

export type PairDesktopState =
  | { step: 'starting' }
  | { step: 'scan'; qr: string }
  | { step: 'code'; code: string; nodeName: string }
  | { step: 'pairing'; nodeName: string }
  | { step: 'failed'; message: string }

/** Why a node QR ended, in the words the dialog shows. */
export function pairDesktopFailureMessage(event: Extract<NodePairingEvent, { type: 'ended' }>, t: TFunction): string {
  if (event.reason === 'expired') return t('settings.remote.addDesktop.errors.qrExpired')
  if (event.reason === 'rejected') return t('settings.remote.addDesktop.errors.cancelled')
  const message = event.message ?? ''
  if (/invalid pairing code/i.test(message)) return t('settings.remote.addDesktop.errors.invalid')
  if (/unsupported_version|newer SuperOne/i.test(message)) return t('settings.remote.addDesktop.errors.unsupportedVersion')
  const failure = classifyPairDesktopError(message)
  return failure ? t(`settings.remote.addDesktop.errors.${failure}`) : message
}

/**
 * Control Other Devices → Add Desktop: a node QR for a phone paired with the
 * desktop to control. The phone checks the code shown here, then hands over
 * that desktop's pairing; a desktop paired before is re-paired in place.
 */
export function PairDesktopDialog({ open, onOpenChange, onPaired }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPaired: (nodeName: string) => void
}) {
  const { t } = useTranslation()
  const [state, setState] = useState<PairDesktopState>({ step: 'starting' })
  // The room lives as long as the dialog is open, not as long as a render.
  const latest = useRef({ onPaired, t })
  latest.current = { onPaired, t }

  const start = useCallback(async () => {
    setState({ step: 'starting' })
    try {
      setState({ step: 'scan', qr: await window.environment.startNodePairing() })
    } catch (err) {
      setState({ step: 'failed', message: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void start()
    const off = window.environment.onNodePairingEvent((event) => {
      if (event.type === 'offer') setState({ step: 'code', code: event.code, nodeName: event.nodeName })
      else if (event.type === 'pairing') setState({ step: 'pairing', nodeName: event.nodeName })
      else if (event.type === 'paired') latest.current.onPaired(event.nodeName)
      else setState({ step: 'failed', message: pairDesktopFailureMessage(event, latest.current.t) })
    })
    return () => {
      off()
      void window.environment.cancelNodePairing()
    }
  }, [open, start])

  return (
    <PairingDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('settings.remote.addDesktop.title')}
      description={t('settings.remote.addDesktop.description')}
      locked={state.step === 'pairing'}
    >
      <PairDesktopBody state={state} onCancel={() => onOpenChange(false)} onRetry={() => void start()} />
    </PairingDialog>
  )
}

/** The dialog body for each step, without IPC, for stories. */
export function PairDesktopBody({ state, onCancel, onRetry }: {
  state: PairDesktopState
  onCancel: () => void
  onRetry: () => void
}) {
  const { t } = useTranslation()
  if (state.step === 'scan') {
    return (
      <PairingQrPanel
        hint={t('settings.remote.addDesktop.description')}
        value={state.qr}
        onCancel={onCancel}
        status={(
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {t('settings.remote.addDesktop.waiting')}
          </p>
        )}
      />
    )
  }
  if (state.step === 'code') {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <p className="text-sm font-medium">{t('settings.remote.addDesktop.codeTitle')}</p>
        <p
          className="rounded-md border border-border bg-muted px-5 py-2 font-mono text-3xl tracking-[0.3em]"
          aria-label={state.code.split('').join(' ')}
        >
          {state.code}
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          {t('settings.remote.addDesktop.codeHint', { name: state.nodeName })}
        </p>
        <Button variant="ghost" size="sm" className="h-7" onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    )
  }
  if (state.step === 'failed') {
    return (
      <>
        <p className="break-words text-sm text-destructive">{state.message}</p>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
          <Button onClick={onRetry}>{t('settings.remote.addDesktop.retry')}</Button>
        </DialogFooter>
      </>
    )
  }
  return (
    <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" />
      {state.step === 'pairing' ? t('settings.remote.addDesktop.pairing', { name: state.nodeName }) : t('common.loading')}
    </p>
  )
}
