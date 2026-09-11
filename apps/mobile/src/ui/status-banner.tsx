import * as Clipboard from 'expo-clipboard'
import { Copy, X } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'
import { useMobileTheme } from '../theme/context'
import { IconButton } from './icon-button'
import { Text } from './text'

/**
 * Host/runtime errors used to sit under the composer, overlapping the home
 * indicator. This strip lives under the header so the message is readable,
 * copyable, and dismissible without covering the input.
 */
export function StatusBanner({ message, onDismiss }: {
  message: string
  onDismiss: () => void
}) {
  const { tokens: { colors } } = useMobileTheme()
  if (!message) return null
  return (
    <View
      testID="status-banner"
      accessibilityRole="alert"
      style={{
        alignItems: 'flex-start',
        backgroundColor: colors.muted,
        borderBottomColor: colors.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderLeftColor: colors.destructive,
        borderLeftWidth: 3,
        flexDirection: 'row',
        gap: 4,
        paddingLeft: 12,
        paddingRight: 4,
        paddingVertical: 6,
      }}
    >
      <Text
        selectable
        style={{ color: colors.foreground, flex: 1, fontSize: 13, lineHeight: 18, paddingVertical: 8 }}
      >
        {message}
      </Text>
      <IconButton
        icon={Copy}
        label="Copy"
        iconSize={16}
        hitSlop={4}
        style={{ width: 36, height: 36 }}
        onPress={() => { void Clipboard.setStringAsync(message) }}
      />
      <IconButton
        icon={X}
        label="Close"
        iconSize={16}
        hitSlop={4}
        style={{ width: 36, height: 36 }}
        onPress={onDismiss}
      />
    </View>
  )
}
