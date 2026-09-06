import type { RefObject } from 'react'
import type { LucideIcon } from 'lucide-react-native'
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import { useMobileTheme } from '../theme/context'

export function IconButton({ icon: Icon, label, onPress, disabled, active, destructive, tone, chrome = 'default', iconSize = 20, style, buttonRef }: {
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
  style?: StyleProp<ViewStyle>
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const iconColor = tone === 'primary' ? colors.primary
    : tone === 'danger' || destructive ? colors.error
      : active ? colors.primaryForeground : colors.mutedForeground
  return (
    <Pressable ref={buttonRef}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [{
        width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
        borderRadius: radius.md,
        backgroundColor: chrome === 'default' ? active ? colors.primary : pressed ? colors.muted : 'transparent' : 'transparent',
        opacity: disabled ? 0.35 : pressed ? 0.7 : 1,
      }, style]}
    >
      {({ pressed }) => chrome === 'circle' ? <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1,
        borderColor: colors.border, backgroundColor: pressed ? colors.muted : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={iconSize} strokeWidth={1.8} color={iconColor} />
      </View> : <Icon size={iconSize} strokeWidth={1.8} color={iconColor} />}
    </Pressable>
  )
}
