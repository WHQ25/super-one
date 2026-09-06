import { Image, ScrollView, View } from 'react-native'
import { Text } from './text'
import { X } from 'lucide-react-native'
import { FileTypeIcon } from './file-icon'
import type { ImageAttachment } from '@superone/shared/agent-types'
import { useMobileTheme } from '../theme/context'
import { IconButton } from './icon-button'

export function AttachmentStrip({ attachments, onRemove }: {
  attachments: ImageAttachment[]
  onRemove: (attachment: ImageAttachment) => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  if (!attachments.length) return null
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
    style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
    {attachments.map((attachment) => <View key={attachment.id ?? attachment.name}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingVertical: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
      {attachment.mimeType.startsWith('image/')
        ? <Image accessibilityLabel={attachment.name} source={{ uri: `data:${attachment.mimeType};base64,${attachment.base64}` }} style={{ width: 44, height: 44, borderRadius: radius.sm }} />
        : <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted, borderRadius: radius.sm }}><FileTypeIcon name={attachment.name} size={24} /></View>}
      <Text numberOfLines={1} style={{ maxWidth: 130, color: colors.foreground, fontSize: 12 }}>{attachment.name}</Text>
      <IconButton icon={X} label={`Remove ${attachment.name}`} onPress={() => onRemove(attachment)} />
    </View>)}
  </ScrollView>
}
