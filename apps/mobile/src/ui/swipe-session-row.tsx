import type { ReactNode } from 'react'
import { Archive, Trash2 } from 'lucide-react-native'
import { SwipeRow } from './swipe-row'

export function SwipeSessionRow(props: {
  title: string
  children: ReactNode
  onPress: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  const subject = props.title || 'session'
  return (
    <SwipeRow
      subject={subject}
      onPress={props.onPress}
      actions={[
        { key: 'archive', label: 'Archive', icon: Archive, onPress: props.onArchive },
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
