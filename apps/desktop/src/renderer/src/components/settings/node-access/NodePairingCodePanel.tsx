import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { Copy, Loader2, RefreshCw } from 'lucide-react'
import type { NodeHostPairingToken } from '@superone/shared/agent-types'
import { encodeNodePairingCode } from '@superone/shared/environment/node-pairing-code'
import { Button } from '@superone/ui/components/ui/button'

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/** Ticks once a second until `until`, then stops. */
function useNowUntil(until: number): number {
  const [now, setNow] = useState(() => Date.now())
  const done = now >= until
  useEffect(() => {
    if (done) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [done])
  return now
}

/**
 * A freshly minted pairing code as text and QR. The code carries the channel
 * secret, so it is shown only here and never logged.
 */
export function NodePairingCodePanel({ token, renewing, onRenew, onDone }: {
  token: NodeHostPairingToken
  renewing: boolean
  onRenew: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const code = useMemo(() => encodeNodePairingCode(token), [token])
  const now = useNowUntil(token.expiresAt)
  const expired = now >= token.expiresAt

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(code)
    toast.success(t('settings.remote.nodeAccess.code.copied'))
  }

  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <p className="text-sm font-medium">{t('settings.remote.nodeAccess.code.title')}</p>
      <p className="max-w-md text-xs text-muted-foreground">{t('settings.remote.nodeAccess.code.instructions')}</p>
      {expired ? (
        <p className="text-xs text-destructive">{t('settings.remote.nodeAccess.code.expired')}</p>
      ) : (
        <>
          {/* The QR code needs a light quiet zone to scan in dark mode too. */}
          <div className="rounded-lg bg-white p-3">
            <QRCodeSVG value={code} size={180} />
          </div>
          <code
            className="block max-h-20 w-full max-w-md select-all overflow-y-auto break-all rounded-md bg-background px-2.5 py-1.5 text-left font-mono text-[11px] text-foreground"
            aria-label={t('settings.remote.nodeAccess.code.title')}
          >
            {code}
          </code>
          <p className="text-xs text-muted-foreground tabular-nums">
            {t('settings.remote.nodeAccess.code.expiresIn', { time: formatRemaining(token.expiresAt - now) })}
          </p>
          <p className="max-w-md text-xs text-warning">{t('settings.remote.nodeAccess.code.warning')}</p>
        </>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {expired ? (
          <Button size="sm" className="h-7" disabled={renewing} onClick={onRenew}>
            {renewing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {t('settings.remote.nodeAccess.code.newCode')}
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="h-7" onClick={() => void copy()}>
            <Copy className="size-3.5" />
            {t('settings.remote.nodeAccess.code.copy')}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7" onClick={onDone}>
          {t('settings.remote.nodeAccess.code.done')}
        </Button>
      </div>
    </div>
  )
}
