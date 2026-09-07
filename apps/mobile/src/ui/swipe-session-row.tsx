import type { ReactNode } from 'react'
import { Archive, Pin, PinOff, Trash2 } from 'lucide-react-native'
import { SwipeRow } from './swipe-row'

export function SwipeSessionRow(props: {
  title: string
  pinned?: boolean
  /** Receives the reveal state so the row can square the edge facing the strip. */
  children: (state: { revealed: boolean }) => ReactNode
  onPress: () => void
  onPin: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  const subject = props.title || 'session'
  return (
    <SwipeRow
      subject={subject}
      variant="floating"
      onPress={props.onPress}
      actions={[
        {
          key: 'pin',
          label: props.pinned ? 'Unpin' : 'Pin',
          icon: props.pinned ? PinOff : Pin,
          onPress: props.onPin,
        },
        { key: 'archive', label: 'Hide', icon: Archive, onPress: props.onArchive },
        {
          key: 'delete',
          label: 'Delete',
          icon: Trash2,
          tone: 'destructive',
          onPress: props.onDelete,
          confirm: {
            title: 'Delete session?',
            message: `“${props.title || 'Untitled'}” and its local transcript will be removed.`,
            confirmLabel: 'Delete',
          },
        },
      ]}
    >
      {props.children}
    </SwipeRow>
  )
}
