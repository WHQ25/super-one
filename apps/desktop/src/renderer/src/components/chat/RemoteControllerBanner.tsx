import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Laptop } from 'lucide-react'

/** "Started from <device>" for a session another device runs on this computer. */
export function remoteControllerBadgeText(t: TFunction, label: string | null): string {
  return label ? t('chat.remoteController.badge', { label }) : t('chat.remoteController.badgeUnknown')
}

/**
 * Replaces the composer for a session another device started here through
 * this computer's node surface. That device holds control; there is no
 * takeover yet, so this computer only watches.
 */
export function RemoteControllerBanner({ label }: { label: string | null }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 py-3 text-center text-sm text-muted-foreground" role="status">
      <span className="flex min-w-0 max-w-full items-center gap-x-2">
        <Laptop className="size-3.5 shrink-0" />
        <span className="min-w-0 break-words font-medium text-foreground">{remoteControllerBadgeText(t, label)}</span>
      </span>
      <span>{t('chat.remoteController.readOnly')}</span>
    </div>
  )
}
