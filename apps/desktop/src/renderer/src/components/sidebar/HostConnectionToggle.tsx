import { Loader2, Power } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'

/**
 * Power control for the selected remote host, beside the project-list refresh
 * button. Pressed means the next click disconnects (live or still dialing).
 */
export function HostConnectionToggle({
  connected,
  busy,
  spinning = false,
  onToggle,
}: {
  /** Live or dialing — the next click disconnects. */
  connected: boolean
  /** A connect or disconnect request from this button is in flight. */
  busy: boolean
  /** Supervisor is dialing; the button stays pressable so the user can abort. */
  spinning?: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const showSpinner = busy || spinning
  // Green while the host is up, red while it is down. Hover keeps the same hue
  // so the state does not disappear into the sidebar's neutral icon color.
  const tone = connected
    ? 'text-success hover:bg-success/15 hover:text-success'
    : 'text-destructive hover:bg-destructive/15 hover:text-destructive'

  return (
    <IconButton
      size="sm"
      className={tone}
      tooltip={connected ? t('settings.environments.disconnect') : t('settings.environments.connect')}
      aria-pressed={connected}
      disabled={busy}
      onClick={onToggle}
    >
      {showSpinner ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Power className="size-3" />
      )}
    </IconButton>
  )
}
