import { Download } from 'lucide-react-native'
import { View } from 'react-native'
import { PromptSheet } from '../prompts/PromptSheet'
import { PromptActions } from '../prompts/PromptControls'
import { Text } from '../ui/text'
import { useMobileLocale } from '../i18n/context'
import { useMobileTheme } from '../theme/context'
import type { DesktopUpgradeProblem } from '../navigation/use-desktop-upgrade'

export interface DesktopUpgradeSheetProps {
  problem: DesktopUpgradeProblem | null
  busy?: boolean
  error?: string
  onReconnect(): void
  onDismiss(): void
}

export function DesktopUpgradeSheet(props: DesktopUpgradeSheetProps) {
  const { t } = useMobileLocale()
  const { tokens: { colors, spacing } } = useMobileTheme()
  if (!props.problem) return null
  const { deviceName, currentVersion, minimumVersion } = props.problem
  return <PromptSheet title="Update Your Desktop" subtitle={deviceName} icon={Download} onDismiss={props.onDismiss}
    footer={<PromptActions tone="submit" approveLabel={props.busy ? 'Connecting…' : 'Reconnect'} rejectLabel="My Devices"
      disabled={props.busy} onApprove={props.onReconnect} onReject={props.onDismiss} />}>
    <View style={{ gap: spacing.md }}>
      <Text style={{ color: colors.foreground, fontSize: 15, lineHeight: 22 }}>{t('Update the paired desktop to the version below, restart SuperOne, then reconnect.')}</Text>
      <Text selectable style={{ color: colors.foreground, fontSize: 16, fontWeight: '600' }}>SuperOne {minimumVersion} {t('or later')}</Text>
      {currentVersion ? <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{t('Current version')}: {currentVersion}</Text> : null}
      <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 20 }}>{t('Your pairing is saved. You can reconnect after the desktop is updated.')}</Text>
      {props.error ? <Text accessibilityRole="alert" style={{ color: colors.destructive, fontSize: 13, lineHeight: 20 }}>{t(props.error)}</Text> : null}
    </View>
  </PromptSheet>
}
