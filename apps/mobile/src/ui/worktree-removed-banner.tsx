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
    {/* 11pt fits the English sentence on one line beside the icon. Narrower
        phones scale it down instead of wrapping the last word. */}
    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
      style={{ flexShrink: 1, color: colors.mutedForeground, fontSize: 11, textAlign: 'center' }}>
      {t('Worktree has been removed. This session is now READ ONLY.')}
    </Text>
  </View>
}
