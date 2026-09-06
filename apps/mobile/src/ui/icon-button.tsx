import type { RefObject } from 'react'
import type { LucideIcon } from 'lucide-react-native'
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import { SpinningIcon } from './spinning-icon'
import { useMobileTheme } from '../theme/context'

export function IconButton({ icon: Icon, label, onPress, disabled, active, destructive, tone, chrome = 'default', iconSize = 20, spinning, style, buttonRef }: {
  buttonRef?: RefObject<View | null>
  icon: LucideIcon
  label: string
  onPress: () => void
  disabled?: boolean
  active?: boolean
  destructive?: boolean
  tone?: 'muted' | 'primary' | 'danger'
  chrome?: 'default' | 'plain' | 'circle'
  iconSize?: number
  /** Rotate the icon to show the action it triggers is still running. */
  spinning?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const glyph = (color: string) => spinning
    ? <SpinningIcon icon={Icon} size={iconSize} color={color} strokeWidth={1.8} />
    : <Icon size={iconSize} strokeWidth={1.8} color={color} />
  // `active` tints the glyph rather than filling the button: a toggle in a header
  // row sits beside plain actions, and a solid block reads as a different kind of
  // control rather than the same one in its on-state.
  const iconColor = tone === 'primary' ? colors.primary
    : tone === 'danger' || destructive ? colors.error
      : active ? colors.primary : colors.mutedForeground
  return (
    <Pressable ref={buttonRef}
      accessibilityRole="button"
      accessibilityLabel={label}
      // `active` is a toggle's on-state, not just a tint — say so, or the only cue
      // a screen reader gets for "search is open" is a colour it cannot see.
      accessibilityState={{ disabled: !!disabled, ...(active === undefined ? {} : { selected: active }) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [{
        width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
        borderRadius: radius.md,
        backgroundColor: chrome === 'default' && pressed ? colors.muted : 'transparent',
        opacity: disabled ? 0.35 : pressed ? 0.7 : 1,
      }, style]}
    >
      {({ pressed }) => chrome === 'circle' ? <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1,
        borderColor: colors.border, backgroundColor: pressed ? colors.muted : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {glyph(iconColor)}
      </View> : glyph(iconColor)}
    </Pressable>
  )
}
