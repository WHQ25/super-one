import { Folder } from 'lucide-react-native'
import { Pressable, ScrollView } from 'react-native'
import { Text } from './text'
import { useMobileTheme } from '../theme/context'

function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

/**
 * The folders a session gets on top of its project root — the desktop's
 * `ChatInputDirsHint` and the Flutter app's row, in React Native.
 *
 * Same rule as both: this is a *launch* fact, so the caller shows it while the
 * session is still being configured and drops it once the session owns the
 * answer. The chip carries the folder name, which is what tells two entries
 * apart; a phone has no hover, so the tap goes to the panel that shows the full
 * paths and edits them — seeing and changing share one entry point rather than
 * the chip dead-ending in a tooltip.
 */
export function AdditionalDirsHint({ dirs, onPress }: { dirs: string[]; onPress: () => void }) {
  const { tokens: { colors } } = useMobileTheme()
  if (!dirs.length) return null
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
    style={{ flexGrow: 0 }} contentContainerStyle={{ alignItems: 'center', gap: 4, paddingRight: 4 }}>
    <Text style={{ marginRight: 2, fontSize: 11, color: colors.mutedForeground }}>Additional folder:</Text>
    {dirs.map((dir) => <DirChip key={dir} dir={dir} onPress={onPress} />)}
  </ScrollView>
}

function DirChip({ dir, onPress }: { dir: string; onPress: () => void }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const name = basename(dir)
  return <Pressable accessibilityRole="button" accessibilityLabel={`Additional folder: ${name}`} onPress={onPress}
      // 20 pt drawn, 44 pt to a finger — a chip sized for the touch target would
      // set the row's height instead of the label doing it.
      hitSlop={{ top: 12, bottom: 12, left: 2, right: 2 }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: colors.border,
        borderRadius: radius.sm, backgroundColor: pressed ? colors.muted : colors.surface })}>
    <Folder size={11} color={colors.primary} />
    <Text numberOfLines={1} style={{ fontSize: 11, color: colors.mutedForeground }}>{name}</Text>
  </Pressable>
}
