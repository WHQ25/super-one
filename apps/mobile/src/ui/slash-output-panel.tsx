import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { ChevronDown, ChevronRight, Terminal } from 'lucide-react-native'
import { Text } from './text'
import { ComposerPanel } from './composer-panel'
import { useMobileTheme } from '../theme/context'

/**
 * Output from a command whose result is not a chat message.
 *
 * `/compact` and a report render into the transcript; everything else leaves
 * only "Command /x executed." and stashes its stdout. On the desktop that
 * stdout opens in a popover over the composer — without something like this it
 * is fetched over the wire and then silently dropped, which is the same as
 * never sending it.
 *
 * It opens collapsed because most of this output is noise: one line saying it
 * exists, and the text a tap away.
 */
export function SlashOutputPanel({ output, onDismiss }: {
  output: { command: string; content: string } | null
  onDismiss: () => void
}) {
  const { tokens: { colors } } = useMobileTheme()
  const [open, setOpen] = useState(false)
  if (!output) return null
  return <ComposerPanel title={`/${output.command}`} icon={Terminal} testID="slash-output-panel"
    onClose={() => { setOpen(false); onDismiss() }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
      accessibilityLabel={open ? `Hide output from /${output.command}` : `Show output from /${output.command}`}
      onPress={() => setOpen((current) => !current)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 }}>
      {open ? <ChevronDown size={14} color={colors.mutedForeground} /> : <ChevronRight size={14} color={colors.mutedForeground} />}
      <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground, fontSize: 13 }}>
        Output from /{output.command}
      </Text>
    </Pressable>
    {open ? <View style={{ paddingTop: 4 }}>
      {/* Command stdout is preformatted; wrapping it would destroy the only
          structure it has. */}
      <Text selectable style={{ color: colors.foreground, fontSize: 12, fontFamily: 'Menlo', lineHeight: 18 }}>
        {output.content}
      </Text>
    </View> : null}
  </ComposerPanel>
}
