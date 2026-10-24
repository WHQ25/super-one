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
  variant = 'default',
  onToggle,
}: {
  /** Live or dialing — the next click disconnects. */
  connected: boolean
  /** A connect or disconnect request from this button is in flight. */
  busy: boolean
  /** Supervisor is dialing; the button stays pressable so the user can abort. */
  spinning?: boolean
  variant?: 'default' | 'nested'
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const showSpinner = busy || spinning
  // Rest matches the other sidebar icons. Hover previews the action: green
  // turns a stopped host on, red turns a live host off.
  const tone = connected ? 'hover:text-destructive' : 'hover:text-success'

  return (
    <IconButton
      size="sm"
      variant={variant}
      className={tone}
      tooltip={connected ? t('settings.environments.disconnect') : t('settings.environments.connect')}
      aria-pressed={connected}
      disabled={busy}
      onClick={onToggle}
    >
      {showSpinner ? <Loader2 className="animate-spin" /> : <Power />}
    </IconButton>
  )
}
