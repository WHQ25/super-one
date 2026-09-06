import { ChevronDown, Folder } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { Text } from './text'
import { useMobileTheme } from '../theme/context'

/** Cap for a long project name; the field is otherwise sized by its content. */
const MAX_WIDTH = 320

/**
 * The project the next session runs in. Tapping it opens the picker page,
 * which is also where projects get added — the same two jobs the desktop
 * splits between the sidebar list and its Add Project dialog.
 *
 * The field is as wide as the name it shows rather than a fixed box, so it
 * reads as a label with an affordance instead of an empty input.
 */
export function ProjectSelect(props: {
  name?: string
  onOpen: () => void
  disabled?: boolean
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  return (
    <View style={{ maxWidth: MAX_WIDTH }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Project: ${props.name ?? 'none'}`}
        accessibilityState={{ disabled: props.disabled }} disabled={props.disabled}
        onPress={props.onOpen}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
          maxWidth: '100%', paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border,
          borderRadius: radius.md, opacity: props.disabled ? 0.45 : 1,
          backgroundColor: pressed ? colors.muted : 'transparent' })}>
        <Folder size={18} color={colors.mutedForeground} />
        <Text numberOfLines={1} style={{ flexShrink: 1, minWidth: 0, fontSize: 14, fontWeight: '500',
          color: colors.foreground }}>
          {props.name ?? 'No project'}
        </Text>
        <ChevronDown size={18} color={colors.mutedForeground} />
      </Pressable>
    </View>
  )
}
