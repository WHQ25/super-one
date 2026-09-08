import { ScrollView, View } from 'react-native'
import type { Locale, ThemeMode } from '@superone/shared/agent-types'
import { Text } from '../ui/text'
import { SelectionField } from '../ui/selection-field'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'

const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark']
const LOCALES: readonly Locale[] = ['en', 'zh']

/** Device-local preferences. Project and harness controls stay on the chat surface. */
export function AppSettingsScreen() {
  const { tokens: { colors, radius, spacing }, mode, setMode } = useMobileTheme()
  const { locale, setLocale, t } = useMobileLocale()
  const sectionLabel = { color: colors.mutedForeground, fontSize: 12, fontWeight: '500' as const }
  const card = { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface }
  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, padding: spacing.md }
  const copy = { flex: 1, minWidth: 0, gap: 3 }
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg }}>
      <View style={{ gap: spacing.sm }}>
        <Text accessibilityRole="header" style={sectionLabel}>{t('Appearance')}</Text>
        <View style={[card, row]}>
          <View style={copy}>
            <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '500' }}>{t('Theme')}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{t('Choose how SuperOne looks on this device.')}</Text>
          </View>
          <SelectionField
            label={t('Theme')}
            compact
            value={mode}
            options={THEME_MODES.map((value) => ({ value, label: t(value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark') }))}
            onChange={(value) => setMode(value as ThemeMode)}
          />
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text accessibilityRole="header" style={sectionLabel}>{t('Language & Region')}</Text>
        <View style={[card, row]}>
          <View style={copy}>
            <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '500' }}>{t('Language')}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
              {t('Interface language for SuperOne. Takes effect immediately.')}
            </Text>
          </View>
          <SelectionField
            label={t('Language')}
            compact
            value={locale}
            options={LOCALES.map((value) => ({ value, label: t(value === 'en' ? 'English' : '中文') }))}
            onChange={(value) => setLocale(value as Locale)}
          />
        </View>
      </View>
    </ScrollView>
  )
}
