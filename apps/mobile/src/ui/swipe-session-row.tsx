import type { ReactNode } from 'react'
import { CircleCheck, Pin, PinOff, Trash2, Undo2 } from 'lucide-react-native'
import { useSessionActivity } from '../navigation/use-session-activity'
import { LIVE_SESSION_STATUSES } from '../session-activity-state'
import { SwipeRow, type SwipeAction } from './swipe-row'

/**
 * Right-swipe actions. Painted left to right as declared: Settle, then Pin,
 * then Delete. Delete sits against the title.
 */
export function SwipeSessionRow(props: {
  title: string
  sessionId?: string
  pinned?: boolean
  /** A row already in the Settled group. The first action becomes Unsettle, and pin is omitted. */
  settled?: boolean
  /** Receives the reveal state so the row can square the edge facing the strip. */
  children: (state: { revealed: boolean }) => ReactNode
  onPress: () => void
  onPin: () => void
  onSettle: () => void
  onDelete: () => void
}) {
  const subject = props.title || 'session'
  const activity = useSessionActivity(props.sessionId ?? '')
  // A running turn or a live voice call is still working. Unsettle stays.
  const working = !props.settled && (
    activity?.realtimeActive === true || LIVE_SESSION_STATUSES.has(activity?.status ?? '')
  )
  const actions: SwipeAction[] = [
    ...(!working ? [{
      key: 'settle',
      label: props.settled ? 'Unsettle' : 'Settle',
      icon: props.settled ? Undo2 : CircleCheck,
      onPress: props.onSettle,
    }] : []),
    ...(!props.settled ? [{
      key: 'pin',
      label: props.pinned ? 'Unpin' : 'Pin',
      icon: props.pinned ? PinOff : Pin,
      onPress: props.onPin,
    }] : []),
    {
      key: 'delete',
      label: 'Delete',
      icon: Trash2,
      tone: 'destructive' as const,
      onPress: props.onDelete,
      confirm: {
        title: 'Delete session?',
        message: `“${props.title || 'Untitled'}” and its local transcript will be removed.`,
        confirmLabel: 'Delete',
      },
    },
  ]
  return (
    <SwipeRow subject={subject} variant="floating" alignActions="start" onPress={props.onPress} actions={actions}>
      {props.children}
    </SwipeRow>
  )
}
