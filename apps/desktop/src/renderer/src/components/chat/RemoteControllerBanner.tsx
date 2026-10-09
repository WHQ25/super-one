import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Laptop } from 'lucide-react'

/** "Started from <device>" for a session another device runs on this computer. */
export function remoteControllerBadgeText(t: TFunction, label: string | null): string {
  return label ? t('chat.remoteController.badge', { label }) : t('chat.remoteController.badgeUnknown')
}

/**
 * Replaces the composer on whichever computer cannot drive the session right
 * now, as for a phone: it names the computer that does. The session's host
 * offers Disconnect (take it back); the controller offers Reconnect.
 */
export function RemoteControlBanner({ label, action, busy = false, onAction }: {
  /** The computer driving the session; null when it gave no name. */
  label: string | null
  action: 'disconnect' | 'reconnect'
  busy?: boolean
  onAction: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 py-3 text-center text-sm text-muted-foreground" role="status">
      <span className="flex min-w-0 max-w-full items-center gap-x-2">
        <Laptop className="size-3.5 shrink-0" />
        <span className="min-w-0 break-words">
          {label ? t('chat.remoteController.controlling', { label }) : t('chat.remoteController.controllingUnknown')}
        </span>
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={onAction}
        className="text-foreground underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
      >
        {t(`chat.remoteController.${action}`)}
      </button>
    </div>
  )
}
