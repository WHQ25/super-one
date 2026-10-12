import { ArrowUp, Clock } from 'lucide-react-native'
import type { ScheduledSendControls } from '../navigation/use-scheduled-send'
import { AnchoredMenu, useMenuAnchor } from './anchored-menu'
import { IconButton } from './icon-button'
import { ScheduledSendPanel } from './scheduled-send-panel'

/** A short tap sends; a long press edits the host schedule without sending. */
export function ScheduledSendControl({ controls, tablet, empty, loading, onSend }: {
  controls: ScheduledSendControls; tablet: boolean; empty: boolean; loading?: boolean; onSend: () => void
}) {
  const menu = useMenuAnchor()
  const armed = controls.scheduled?.armed
  return <>
    <IconButton buttonRef={menu.ref} icon={armed || empty ? Clock : ArrowUp} label={armed ? 'Scheduled send' : empty ? 'Schedule Send' : 'Send'}
      accessibilityHint="Long press to schedule a message" tone={tablet ? 'muted' : 'primary'} chrome={tablet ? 'circle' : 'plain'} iconSize={tablet ? 13 : 20}
      disabled={loading || controls.busy || (controls.loading && !controls.error)}
      onPress={armed || empty || controls.error ? menu.open : onSend}
      onLongPress={controls.available ? menu.open : undefined} />
    <AnchoredMenu anchor={menu.anchor} title="Scheduled send" onDismiss={menu.close} remeasure={menu.remeasure} width={320}>
      <ScheduledSendPanel controls={controls} onClose={menu.close} />
    </AnchoredMenu>
  </>
}
