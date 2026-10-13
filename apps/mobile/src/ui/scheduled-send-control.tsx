import { ArrowUp, Clock } from 'lucide-react-native'
import { useEffect } from 'react'
import type { ScheduledSendControls } from '../navigation/use-scheduled-send'
import { AnchoredMenu, useMenuAnchor } from './anchored-menu'
import { IconButton } from './icon-button'
import { ScheduledSendPanel } from './scheduled-send-panel'
import { useMobileTheme } from '../theme/context'

/** A short tap sends; a long press edits the host schedule without sending. */
export function ScheduledSendControl({ controls, tablet, empty, loading, onSend, onOpenChange }: {
  controls: ScheduledSendControls; tablet: boolean; empty: boolean; loading?: boolean; onSend: () => void; onOpenChange?: (open: boolean) => void
}) {
  const menu = useMenuAnchor()
  const { tokens: { colors } } = useMobileTheme()
  const armed = controls.scheduled?.armed
  useEffect(() => {
    onOpenChange?.(menu.anchor !== null)
    return () => onOpenChange?.(false)
  }, [menu.anchor, onOpenChange])
  return <>
    <IconButton buttonRef={menu.ref} icon={armed ? Clock : ArrowUp} label={armed ? 'Scheduled send' : 'Send'}
      accessibilityHint="Long press to schedule a message" tone={armed || tablet ? 'muted' : 'primary'} color={armed ? colors.warning : undefined}
      chrome={tablet ? 'circle' : 'plain'} iconSize={tablet ? 13 : 20}
      disabled={loading || controls.busy || (controls.loading && !controls.error) || (!armed && empty)}
      onPress={armed ? menu.open : onSend}
      onLongPress={controls.available || controls.error ? menu.open : undefined} />
    <AnchoredMenu anchor={menu.anchor} title="Scheduled send" onDismiss={menu.close} remeasure={menu.remeasure} width={320}>
      <ScheduledSendPanel controls={controls} onClose={menu.close} />
    </AnchoredMenu>
  </>
}
