import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react-native'
import { ScrollView, View } from 'react-native'
import { X } from 'lucide-react-native'
import { Text } from './text'
import { IconButton } from './icon-button'
import { useMobileTheme } from '../theme/context'

/**
 * The one shape a composer surface takes: an inline layer above the input.
 *
 * Everything the composer opens — suggestions, a command's readout, a
 * command's output — sits here, in the same 256 px card the slash and mention
 * overlays use. Not a modal sheet: the draft stays visible and the keyboard
 * stays up, and on the desktop these are `bottom-full` popovers over the
 * composer rather than dialogs. A sheet would also make two of them
 * impossible to reason about together.
 */
export function ComposerPanel({ title, icon: Icon, testID, onClose, children }: {
  title: string
  icon: LucideIcon
  testID: string
  onClose: () => void
  children: ReactNode
}) {
  const { tokens: { colors } } = useMobileTheme()
  return <View testID={testID} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    backgroundColor: colors.surface, overflow: 'hidden' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 4,
      minHeight: 36, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Icon size={14} color={colors.mutedForeground} />
      <Text style={{ flex: 1, color: colors.mutedForeground, fontSize: 12 }}>{title}</Text>
      <IconButton icon={X} label={`Close ${title}`} chrome="plain" iconSize={16} onPress={onClose} />
    </View>
    <ScrollView keyboardShouldPersistTaps="always" style={{ maxHeight: 256, flexGrow: 0 }}
      contentContainerStyle={{ padding: 8, gap: 2 }}>
      {children}
    </ScrollView>
  </View>
}
