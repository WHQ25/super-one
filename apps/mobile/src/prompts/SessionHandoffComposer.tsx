import { AtSign, Forward, Network, type LucideIcon } from 'lucide-react-native'
import { View } from 'react-native'
import { useMobileLocale } from '../i18n/context'
import { useMobileTheme } from '../theme/context'
import { Text } from '../ui/text'
import { PromptActions } from './PromptControls'
import { tint, usePromptStyles } from './styles'

const BENEFITS: Array<{ icon: LucideIcon; text: string }> = [
  { icon: AtSign, text: 'The new session mentions this one automatically, so its context is kept and the agent reads it as needed.' },
  { icon: Network, text: 'Keeps working with every collaborator of this session.' },
]

/**
 * The handoff a long session whose prompt cache expired offers in the
 * composer slot, as the desktop does (docs/features/session-continuation.md).
 */
export function SessionHandoffComposer({ onApprove, onDismiss }: { onApprove(): void; onDismiss(): void }) {
  const styles = usePromptStyles()
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  return <View testID="session-handoff-composer" style={[styles.stack, { padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background }]}>
    <View style={styles.row}>
      <View style={{ width: 32, height: 32, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: tint(colors.primary, '1f') }}>
        <Forward size={16} color={colors.primary} />
      </View>
      <Text accessibilityRole="header" style={[styles.title, styles.grow]}>{t('Handoff to New Session')}</Text>
    </View>
    <Text style={styles.meta}>{t('This session is long and its cache has expired. Continuing it here uploads the whole context again: slower, more expensive, and heavy on your subscription usage. Handing off to a new session is recommended.')}</Text>
    <View style={styles.tight}>
      {BENEFITS.map(({ icon: Icon, text }) => <View key={text} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <Icon size={14} color={colors.mutedForeground} style={{ marginTop: 3 }} />
        <Text style={[styles.meta, styles.grow, { color: colors.foreground }]}>{t(text)}</Text>
      </View>)}
    </View>
    <PromptActions tone="submit" approveLabel="Approve" rejectLabel="Dismiss" onApprove={onApprove} onReject={onDismiss} />
  </View>
}
