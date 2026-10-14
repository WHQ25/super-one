import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Laptop, Smartphone } from 'lucide-react'

/** "Started from <device>" for a session another device runs on this computer. */
export function remoteControllerBadgeText(t: TFunction, label: string | null): string {
  return label ? t('chat.remoteController.badge', { label }) : t('chat.remoteController.badgeUnknown')
}

/**
 * Replaces the composer on whichever computer cannot drive the session right
 * now, as for a phone: it names the device that does. The session's host
 * offers Disconnect (take it back); a controller offers Reconnect, or Take
 * over from the host's window. A phone or another controller driving a
 * session elsewhere cannot be taken, so it offers nothing.
 */
export function RemoteControlBanner({ label, device = 'computer', action, busy = false, onAction }: {
  /** The device driving the session; null when it gave no name. */
  label: string | null
  device?: 'computer' | 'phone'
  action?: 'disconnect' | 'reconnect' | 'takeOver'
  busy?: boolean
  onAction?: () => void
}) {
  const { t } = useTranslation()
  const Icon = device === 'phone' ? Smartphone : Laptop
  const unknown = device === 'phone' ? t('chat.remoteController.controllingPhoneUnknown') : t('chat.remoteController.controllingUnknown')
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 py-3 text-center text-sm text-muted-foreground" role="status">
      <span className="flex min-w-0 max-w-full items-center gap-x-2">
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 break-words">
          {label ? t('chat.remoteController.controlling', { label }) : unknown}
        </span>
      </span>
      {action && (
        <button
          type="button"
          disabled={busy}
          onClick={onAction}
          className="text-foreground underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
        >
          {t(`chat.remoteController.${action}`)}
        </button>
      )}
    </div>
  )
}
