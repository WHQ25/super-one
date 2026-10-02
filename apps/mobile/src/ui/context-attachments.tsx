import { ActivityIndicator, Image, Pressable, View } from 'react-native'
import { FileText, X } from 'lucide-react-native'
import type { ContextAttachment } from '@superone/shared/context-attachments'
import { safeImageUri } from '@superone/shared/image-uri'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'
import { AnchoredMenu, useMenuAnchor } from './anchored-menu'
import { Text } from './text'
import { ContextThumbnail } from './context-thumbnail'

/** Native renderer of the same generic attachment contract used by desktop composers. */
export function ContextAttachments({ items, onRemove, removing = [], loading, error }: {
  items: ContextAttachment[]; onRemove?: (id: string) => void; removing?: string[]; loading?: boolean; error?: string
}) {
  const { tokens: { colors } } = useMobileTheme()
  if (!items.length && !loading && !error) return null
  return <View style={{ padding: 6, gap: 4 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {items.map(item => <Attachment key={item.id} item={item} onRemove={onRemove} removing={removing.includes(item.id)} />)}
      {loading ? <ActivityIndicator accessibilityLabel="Loading attachments" color={colors.mutedForeground} /> : null}
    </View>
    {error ? <Text accessibilityRole="alert" style={{ fontSize: 12, color: colors.destructive }}>{error}</Text> : null}
  </View>
}

function Attachment({ item, onRemove, removing }: { item: ContextAttachment; onRemove?: (id: string) => void; removing: boolean }) {
  const menu = useMenuAnchor()
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const thumbnail = safeImageUri(item.thumbnail ?? item.icon)
  const title = item.fields === undefined ? item.title : item.fields === 1 ? t('1 field') : t('{{count}} fields').replace('{{count}}', String(item.fields))
  return <>
    <View style={{ maxWidth: '100%', flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
      <Pressable ref={menu.ref} accessibilityRole="button" accessibilityLabel={title} onPress={menu.open}
        style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32, paddingHorizontal: 8 }}>
        {thumbnail ? <ContextThumbnail key={thumbnail} src={thumbnail} /> : <FileText size={14} color={colors.mutedForeground} />}
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12 }}>{item.source ? `${item.source} · ` : ''}{title}</Text>
      </Pressable>
      {onRemove ? <Pressable accessibilityRole="button" accessibilityLabel={`${t('Remove Attachment')}: ${title}`} accessibilityState={{ disabled: removing }} disabled={removing} hitSlop={6} onPress={() => onRemove(item.id)} style={{ padding: 8 }}>
        {removing ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <X size={12} color={colors.mutedForeground} />}
      </Pressable> : null}
    </View>
    <AnchoredMenu anchor={menu.anchor} title={title} onDismiss={menu.close} width={320}>
      <ContextAttachmentPreview item={item} />
    </AnchoredMenu>
  </>
}

export function ContextAttachmentPreview({ item }: { item: ContextAttachment }) {
  return <View style={{ padding: 12, gap: 8 }}>
    {item.previewImages?.map((image, index) => safeImageUri(image.src) ? <Image key={index} accessibilityLabel={image.alt} source={{ uri: safeImageUri(image.src)! }} resizeMode="contain" style={{ width: '100%', height: 160 }} /> : null)}
    <Text selectable style={{ fontSize: 12 }}>{item.content || item.title}</Text>
  </View>
}
