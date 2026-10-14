import type { TransportLedger } from '@superone/relay-client'
import { NetworkLedgerPanel } from '../ui/network-ledger-panel'
import { networkLedger, networkMetricsEnabled } from '../network-ledger'
import { ScrollView } from 'react-native'
import type { Locale, ThemeMode } from '@superone/shared/agent-types'
import { Text } from '../ui/text'
import { Button } from '../ui/primitives'
import { SelectionField } from '../ui/selection-field'
import { SettingsRow, SettingsSection } from '../ui/settings-section'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'
import { formatBuildLabel } from '../updates/update-format'
import { useUpdateStatus } from '../updates/update-context'

const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark']
const LOCALES: readonly Locale[] = ['en', 'zh']

/**
 * What the About section needs from the updater.
 *
 * Optional so the three existing call sites -- the shell, the offline preview
 * and the component test -- keep compiling, and so `expo-application` is never
 * imported by the screen itself.
 */
export type AppSettingsUpdateProps = {
  version: string | null
  buildCode: number | null
  checking?: boolean
  onCheckForUpdates?: () => void
}

/** Device-local preferences. Project and harness controls stay on the chat surface. */
export function AppSettingsScreen({ update, ledger }: { update?: AppSettingsUpdateProps; ledger?: TransportLedger } = {}) {
  const { tokens: { spacing }, mode, setMode } = useMobileTheme()
  const { locale, setLocale, t } = useMobileLocale()
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.xl, gap: 20 }}>
      <SettingsSection title={t('Appearance')}>
        <SettingsRow label={t('Theme')} description={t('Choose how SuperOne looks on this device.')}>
          <SelectionField
            label={t('Theme')}
            compact
            value={mode}
            options={THEME_MODES.map((value) => ({ value, label: t(value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark') }))}
            onChange={(value) => setMode(value as ThemeMode)}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t('Language & Region')}>
        <SettingsRow label={t('Language')} description={t('Interface language for SuperOne. Takes effect immediately.')}>
          <SelectionField
            label={t('Language')}
            compact
            value={locale}
            options={LOCALES.map((value) => ({ value, label: t(value === 'en' ? 'English' : '中文') }))}
            onChange={(value) => setLocale(value as Locale)}
          />
        </SettingsRow>
      </SettingsSection>

      {update ? (
        <SettingsSection title={t('About')}>
          <SettingsRow label={t('Version')} description={
            <Text testID="settings-build">{formatBuildLabel(update.version, update.buildCode)}</Text>
          }>
            {update.onCheckForUpdates ? (
              <Button
                label={update.checking ? 'Checking…' : 'Check for updates'}
                variant="secondary"
                disabled={update.checking}
                onPress={update.onCheckForUpdates}
              />
            ) : null}
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {ledger ? <NetworkLedgerPanel ledger={ledger} /> : null}
    </ScrollView>
  )
}

/**
 * The shell's mount, reading what the update gate publishes.
 *
 * Split from `AppSettingsScreen` so the screen itself stays a pure props
 * component -- the preview and the component tests hand it their own values
 * rather than standing up a provider.
 */
export function ConnectedAppSettingsScreen() {
  const status = useUpdateStatus()
  if (!status) return <AppSettingsScreen ledger={networkMetricsEnabled ? networkLedger : undefined} />
  return (
    <AppSettingsScreen
      ledger={networkMetricsEnabled ? networkLedger : undefined}
      update={{
        version: status.state.currentVersion,
        buildCode: status.state.currentBuildCode,
        checking: status.state.checking,
        onCheckForUpdates: () => status.actions.check(true),
      }}
    />
  )
}
