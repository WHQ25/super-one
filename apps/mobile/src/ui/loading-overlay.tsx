import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { Text } from './text'
import { useMobileTheme } from '../theme/context'

export function LoadingOverlay({ label }: { label: string }) {
  const { tokens: { colors } } = useMobileTheme()
  return <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 12 }]}>
    <ActivityIndicator color={colors.mutedForeground} />
    <Text accessibilityRole="text" style={{ color: colors.mutedForeground, fontSize: 13 }}>{label}</Text>
  </View>
}
