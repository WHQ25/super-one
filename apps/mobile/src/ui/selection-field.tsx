import { ChevronDown } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { Text } from './text'
import { useMobileTheme } from '../theme/context'
import { AnchoredMenu, MenuRow, useMenuAnchor } from './anchored-menu'

export type SelectionOption = { value: string; label: string; description?: string }

export function SelectionField({ label, value, options, onChange, compact = false, hint, disabled }: {
  label: string; value: string; options: SelectionOption[]; onChange: (value: string) => void
  compact?: boolean; hint?: string; disabled?: boolean
}) {
  const menu = useMenuAnchor()
  const { tokens: { colors, radius } } = useMobileTheme()
  const selected = options.find((option) => option.value === value)
  return <>
    <Pressable ref={menu.ref} disabled={disabled} accessibilityState={{ disabled, expanded: !!menu.anchor }} accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label ?? value}`} onPress={menu.open} style={({ pressed }) => ({
      minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: compact ? 6 : 12, paddingVertical: 8, borderRadius: radius.md,
      backgroundColor: pressed ? colors.muted : compact ? 'transparent' : colors.background,
    })}>
      <View style={compact ? { maxWidth: 180 } : { flex: 1 }}>
        {!compact ? <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 4 }}>{label}</Text> : null}
        <Text numberOfLines={1} style={{ color: compact ? colors.mutedForeground : colors.foreground, fontSize: compact ? 12 : 15 }}>{selected?.label ?? (value || (compact ? label : 'Choose…'))}</Text>
      </View>
      <ChevronDown size={14} color={colors.mutedForeground} />
    </Pressable>
    <AnchoredMenu anchor={menu.anchor} title={label} onDismiss={menu.close}>
      {hint ? <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 18, padding: 8 }}>{hint}</Text> : null}
      {options.map((option) => <MenuRow key={option.value} label={option.label} description={option.description}
        selected={option.value === value}
        onPress={() => { onChange(option.value); menu.close() }} />)}
      {!options.length ? <Text style={{ color: colors.mutedForeground, fontSize: 13, padding: 12 }}>No options available</Text> : null}
    </AnchoredMenu>
  </>
}
