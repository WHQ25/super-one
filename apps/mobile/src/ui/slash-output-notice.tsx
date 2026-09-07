import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Terminal, X } from 'lucide-react-native'
import { Text } from './text'
import { IconButton } from './icon-button'
import { Sheet } from './primitives'
import { useMobileTheme } from '../theme/context'

/**
 * Output from a command whose result is not a chat message.
 *
 * `/compact` and a report render into the transcript; everything else leaves
 * only "Command /x executed." and stashes its stdout. On the desktop that
 * stdout opens in a panel — without something like this it is fetched over the
 * wire and then silently dropped, which is the same as never sending it.
 */
export function SlashOutputNotice({ output, onDismiss }: {
  output: { command: string; content: string } | null
  onDismiss: () => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const [open, setOpen] = useState(false)
  if (!output) return null
  return <>
    <View testID="slash-output-notice" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 4,
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, minHeight: 40 }}>
      <Terminal size={14} color={colors.mutedForeground} />
      <Pressable accessibilityRole="button" accessibilityLabel={`Show output from /${output.command}`}
        onPress={() => setOpen(true)} style={{ flex: 1, minHeight: 40, justifyContent: 'center' }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13 }}>
          Output from /{output.command}
        </Text>
      </Pressable>
      <IconButton icon={X} label="Dismiss command output" chrome="plain" iconSize={15}
        onPress={() => { setOpen(false); onDismiss() }} />
    </View>
    <Sheet visible={open} title={`/${output.command}`} icon={Terminal} onDismiss={() => setOpen(false)}>
      <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ padding: 12 }}>
        {/* Command stdout is preformatted; wrapping it would destroy the only
            structure it has. */}
        <Text selectable style={{ color: colors.foreground, fontSize: 12, fontFamily: 'Menlo', lineHeight: 18 }}>
          {output.content}
        </Text>
      </ScrollView>
    </Sheet>
  </>
}
