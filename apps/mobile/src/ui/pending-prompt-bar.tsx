import { Pressable } from 'react-native'
import { ChevronUp } from 'lucide-react-native'
import { pendingPromptHeader, type PendingPrompt } from '../pending-prompt-state'
import { pendingPromptIcon } from '../prompts/prompt-icon'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'
import { Pulse } from './pulse'
import { Text } from './text'

/**
 * A prompt the user put away with an outside tap, waiting above the composer.
 * Tapping anywhere on it reopens the sheet; there is deliberately no close
 * here — the only way to resolve the request is the sheet's own close button
 * or its actions, so a stray tap can never deny it.
 *
 * This is the desktop's collapsed `PermissionPrompt` row (`mx-3 mb-2
 * rounded-lg border bg-card px-3 py-2`): an inset, *filled* card, unlike the
 * todo strip beside it. The todo list is part of the chat column and sits on
 * its background; a decision the agent is blocked on is set apart from it —
 * the fill, the border and the breathing glyph are what say "this is not a
 * tool row, it is waiting for you".
 */
export function PendingPromptBar(props: {
  prompt: PendingPrompt
  onExpand: (requestId: string) => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  const { title, detail } = pendingPromptHeader(props.prompt)
  const Icon = pendingPromptIcon(props.prompt)
  const label = t(title)
  return (
    <Pressable
      testID="pending-prompt-bar"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('Reopens the dialog')}
      onPress={() => props.onExpand(props.prompt.request.requestId)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginHorizontal: 12,
        marginBottom: 8,
        paddingHorizontal: 12,
        // Desktop's row is ~34 px on a pointer; a finger needs the full 44.
        minHeight: 44,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.lg,
        backgroundColor: pressed ? colors.muted : colors.surface,
      })}
    >
      <Pulse active>
        <Icon size={16} color={colors.mutedForeground} />
      </Pulse>
      <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '500', color: colors.foreground, flexShrink: 1 }}>{label}</Text>
      {detail ? <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: colors.mutedForeground }}>{detail}</Text> : null}
      <ChevronUp size={16} color={colors.mutedForeground} style={{ marginLeft: 'auto' }} />
    </Pressable>
  )
}
