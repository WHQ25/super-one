import { GitFork } from 'lucide-react-native'
import { View } from 'react-native'
import { useMobileLocale } from '../i18n/context'
import { useMobileTheme } from '../theme/context'
import { Text } from './text'

/** A removed session checkout withdraws the composer, matching desktop. */
export function WorktreeRemovedBanner() {
  const { t } = useMobileLocale()
  const { tokens: { colors } } = useMobileTheme()
  return <View testID="worktree-removed-banner" accessibilityRole="alert"
    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.background }}>
    <GitFork size={14} color={colors.mutedForeground} />
    <Text style={{ flexShrink: 1, color: colors.mutedForeground, fontSize: 13, lineHeight: 20, textAlign: 'center' }}>
      {t('Worktree has been removed. This session is now READ ONLY.')}
    </Text>
  </View>
}
