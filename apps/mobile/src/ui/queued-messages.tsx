import type { ChatMessage } from '@superone/shared/agent-types'
import { ChevronsUp, PenLine, ShipWheel } from 'lucide-react-native'
import { View } from 'react-native'
import { queuedMessageText } from '../queued-send'
import { useMobileTheme } from '../theme/context'
import { IconButton } from './icon-button'
import { Text } from './text'

export function QueuedMessages({ messages, canSteer, canSteerSoon, onEdit, onSteer, onSteerSoon }: {
  messages: ChatMessage[]
  canSteer: boolean
  canSteerSoon: boolean
  onEdit: (messageId: string) => void
  onSteer: (messageId: string) => void
  onSteerSoon: (messageId: string) => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  if (!messages.length) return null
  return <View testID="queued-messages" style={{ paddingHorizontal: 12, paddingBottom: 4, gap: 8 }}>
    {messages.map((message) => {
      const text = queuedMessageText(message)
      return <View key={message.id} style={{ gap: 2 }}>
        <View style={{
          alignSelf: 'flex-end', maxWidth: '82%', opacity: 0.5,
          backgroundColor: colors.muted, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 8,
        }}>
          <Text style={{ color: colors.foreground, fontSize: 15, lineHeight: 22 }}>{text || message.attachments?.[0]?.name || 'Attachment'}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
          {canSteerSoon ? <IconButton icon={ChevronsUp} label="Steer soon" iconSize={16} onPress={() => onSteerSoon(message.id)} /> : null}
          {canSteer ? <IconButton icon={ShipWheel} label="Steer now" iconSize={16} onPress={() => onSteer(message.id)} /> : null}
          <IconButton icon={PenLine} label="Edit queued" iconSize={16} onPress={() => onEdit(message.id)} />
        </View>
      </View>
    })}
  </View>
}
