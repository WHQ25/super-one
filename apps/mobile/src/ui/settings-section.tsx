import type { ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import { useMobileTheme } from '../theme/context'
import { Text } from './text'

/** Match desktop's muted cards and compact rows; controls retain native touch targets. */
export const settingsRowStyle: ViewStyle = { paddingHorizontal: 12, paddingVertical: 10 }

export function SettingsCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  return <View style={[{ backgroundColor: `${colors.muted}80`, borderRadius: radius.md }, style]}>{children}</View>
}

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const { tokens: { colors, spacing } } = useMobileTheme()
  return (
    <View style={{ gap: spacing.sm }}>
      <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 13, fontWeight: '500', marginLeft: spacing.xs }}>{title}</Text>
      <SettingsCard>{children}</SettingsCard>
    </View>
  )
}

export function SettingsRow({ label, description, children }: {
  label: string
  description?: ReactNode
  children?: ReactNode
}) {
  const { tokens: { colors, spacing } } = useMobileTheme()
  return (
    <View style={[settingsRowStyle, { flexDirection: 'row', alignItems: 'center', gap: spacing.md }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: colors.foreground, fontSize: 14 }}>{label}</Text>
        {description ? <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17 }}>{description}</Text> : null}
      </View>
      {children}
    </View>
  )
}
