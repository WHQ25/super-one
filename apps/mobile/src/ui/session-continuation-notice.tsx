import { History } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { useMobileLocale } from '../i18n/context'
import { useMobileTheme } from '../theme/context'
import { Text } from './text'

/** What the composer offers for a long session whose prompt cache expired. */
export type SessionContinuationControls = {
  onContinue(): void
  onContinueHere(): void
  onDontShowAgain(): void
}

/** The row above the composer, as the desktop draws it (docs/features/session-continuation.md). */
export function SessionContinuationNotice({ controls }: { controls: SessionContinuationControls }) {
  const { t } = useMobileLocale()
  const { tokens: { colors, radius } } = useMobileTheme()
  const link = (label: string, onPress: () => void) => <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8}
    style={({ pressed }) => ({ paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}>
    <Text style={{ fontSize: 12, color: colors.mutedForeground, textDecorationLine: 'underline' }}>{t(label)}</Text>
  </Pressable>
  return <View testID="session-continuation-notice" accessibilityRole="summary"
    style={{ gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
      <History size={14} color={colors.mutedForeground} style={{ marginTop: 2 }} />
      <Text style={{ flex: 1, fontSize: 12, lineHeight: 18, color: colors.mutedForeground }}>
        {t('This session is long and its cache has expired. Continuing here re-caches the whole context.')}
      </Text>
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 4, paddingLeft: 20 }}>
      <Pressable accessibilityRole="button" onPress={controls.onContinue}
        style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm,
          backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 })}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: colors.foreground }}>{t('Continue in New Session')}</Text>
      </Pressable>
      {link('Continue Here', controls.onContinueHere)}
      {link('Don’t Show Again', controls.onDontShowAgain)}
    </View>
  </View>
}
