import { ActivityIndicator, Image, Pressable, View } from 'react-native'
import { AppWindow, X } from 'lucide-react-native'
import type { ContextAttachment } from '@superone/shared/context-attachments'
import { safeImageUri } from '@superone/shared/image-uri'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'
import { AnchoredMenu, useMenuAnchor } from './anchored-menu'
import { Text } from './text'
import { ContextThumbnail } from './context-thumbnail'
import { monospace } from '../prompts/styles'

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
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  const icon = safeImageUri(item.icon)
  const thumbnail = safeImageUri(item.thumbnail)
  const title = item.fields === undefined ? item.title : item.fields === 1 ? t('1 field') : t('{{count}} fields').replace('{{count}}', String(item.fields))
  const appIcon = <AppWindow size={12} color={colors.mutedForeground} />
  // The desktop chip: a filled single line of icon, source, a muted summary and a small remove action.
  return <>
    <View style={{ maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.sm, backgroundColor: colors.muted, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Pressable ref={menu.ref} accessibilityRole="button" accessibilityLabel={title} onPress={menu.open} hitSlop={{ top: 10, bottom: 10, left: 6 }}
        style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {icon ? <ContextThumbnail key={icon} src={icon} size={12} fallback={thumbnail ? null : appIcon} /> : thumbnail ? null : appIcon}
        {thumbnail ? <ContextThumbnail key={thumbnail} src={thumbnail} size={16} /> : null}
        {item.source ? <>
          <Text numberOfLines={1} style={{ flexShrink: 0, maxWidth: 140, fontSize: 12, fontWeight: '500', color: colors.foreground }}>{item.source}</Text>
          <Text style={{ fontSize: 10, color: colors.mutedForeground }}>·</Text>
        </> : null}
        <Text numberOfLines={1} style={{ flexShrink: 1, maxWidth: 240, fontSize: 11, color: colors.mutedForeground }}>{title}</Text>
      </Pressable>
      {onRemove ? <Pressable accessibilityRole="button" accessibilityLabel={`${t('Remove Attachment')}: ${title}`} accessibilityState={{ disabled: removing }} disabled={removing} hitSlop={10} onPress={() => onRemove(item.id)} style={{ marginLeft: 2, opacity: removing ? 0.5 : 0.7 }}>
        {removing ? <ActivityIndicator size="small" color={colors.mutedForeground} style={{ width: 10, height: 10, transform: [{ scale: 0.5 }] }} /> : <X size={10} color={colors.mutedForeground} />}
      </Pressable> : null}
    </View>
    {/* As wide as the composer allows, like the desktop popover (up to 40rem). */}
    <AnchoredMenu anchor={menu.anchor} title={item.source ?? title} onDismiss={menu.close} width={640} titleProminent
      titleIcon={icon ? <ContextThumbnail key={icon} src={icon} size={14} fallback={<AppWindow size={14} color={colors.mutedForeground} />} /> : <AppWindow size={14} color={colors.mutedForeground} />}>
      <ContextAttachmentPreview item={item} />
    </AnchoredMenu>
  </>
}

export function ContextAttachmentPreview({ item }: { item: ContextAttachment }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  return <View style={{ paddingHorizontal: 4, paddingBottom: 4, gap: 6 }}>
    {item.previewImages?.map((image, index) => safeImageUri(image.src) ? <Image key={index} accessibilityLabel={image.alt} source={{ uri: safeImageUri(image.src)! }} resizeMode="contain" style={{ width: '100%', height: 160, borderRadius: 4 }} /> : null)}
    {item.content ? <Text selectable style={{ borderRadius: radius.sm, backgroundColor: colors.muted, padding: 8, fontFamily: monospace, fontSize: 12, lineHeight: 19, color: colors.mutedForeground }}>{item.content}</Text> : null}
  </View>
}
