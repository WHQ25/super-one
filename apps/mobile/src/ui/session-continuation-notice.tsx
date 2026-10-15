import { History, X } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { useMobileLocale } from '../i18n/context'
import { useMobileTheme } from '../theme/context'
import { IconButton } from './icon-button'
import { Text } from './text'

/** What the composer offers for a long session whose prompt cache expired. */
export type SessionContinuationControls = {
  onContinue(): void
  /** Close: keep going in this session until its cache expires again. */
  onContinueHere(): void
}

/**
 * The row above the composer (docs/features/session-continuation.md), drawn
 * like `PendingPromptBar`: one 44 pt filled card. Turning the hint off is a
 * desktop setting.
 */
export function SessionContinuationNotice({ controls }: { controls: SessionContinuationControls }) {
  const { t } = useMobileLocale()
  const { tokens: { colors, radius } } = useMobileTheme()
  return <View testID="session-continuation-notice" accessibilityRole="summary"
    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingLeft: 12, paddingRight: 4,
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface }}>
    <History size={15} color={colors.mutedForeground} />
    <Text numberOfLines={1} accessibilityHint={t('Continuing here re-caches the whole context.')}
      style={{ flex: 1, fontSize: 13, color: colors.foreground }}>
      {t('Long session cache expired')}
    </Text>
    <Pressable accessibilityRole="button" onPress={controls.onContinue}
      style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill,
        backgroundColor: colors.primary, opacity: pressed ? 0.75 : 1 })}>
      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '600', color: colors.primaryForeground }}>
        {t('Continue in New Session')}
      </Text>
    </Pressable>
    <IconButton icon={X} label="Continue Here" chrome="plain" iconSize={16}
      style={{ width: 32, height: 32 }} hitSlop={6} onPress={controls.onContinueHere} />
  </View>
}
