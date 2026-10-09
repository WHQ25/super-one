import type { ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'

/**
 * A pairing QR for a phone to scan: which phone scans it, the code and
 * Cancel. Development builds can copy the link to paste into a simulator.
 */
export function PairingQrPanel(props: {
  /** Which phone scans the code. */
  hint: string
  value: string
  onCancel: () => void
  /** Status under the QR, e.g. waiting for the phone. */
  status?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-3 py-5 text-center">
      <p className="max-w-md text-sm text-muted-foreground">{props.hint}</p>
      {/* The QR code needs a light quiet zone to scan in dark mode too. */}
      <div className="rounded-lg bg-white p-3">
        <QRCodeSVG value={props.value} size={200} />
      </div>
      {props.status}
      <div className="flex items-center gap-2">
        {import.meta.env.DEV && (
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => {
              void navigator.clipboard.writeText(props.value)
              toast.success(t('resources.remote.linkCopied'))
            }}
          >
            {t('resources.remote.copyLink')}
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-7" onClick={props.onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}
