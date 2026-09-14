import { ScrollView, View } from 'react-native'
import type { RemoteUsage } from '@superone/shared/agent-types'
import { Text } from '../ui/text'
import { ContextRing } from '../ui/context-ring'
import { UsagePanel, type UsageMeterProps } from '../ui/usage-panel'
import { useMobileTheme } from '../theme/context'
import { USAGE_FIXTURES, inSeconds } from './usage-fixtures'

const noop = () => {}
const meter = (usage: RemoteUsage | null, extra: Partial<UsageMeterProps> = {}): UsageMeterProps => ({
  usage, onOpen: noop, onRefresh: noop, onConsumeResetCredit: async () => 'reset', ...extra,
})

/**
 * Every state of the composer's meter chip and its panel, in one scroll.
 *
 * The states worth reviewing are the ones a healthy account never shows: a
 * 5h window in the red, a Codex reset credit waiting to be redeemed, a live
 * rejection arriving before any polled reading, a Grok reading 45 minutes
 * stale. The rows render the shipping `ContextRing` and `UsagePanel`.
 */
export function UsageGallery() {
  const { tokens: { colors } } = useMobileTheme()
  const { claude, codex, grok, glm } = USAGE_FIXTURES
  const chips: Array<[string, React.ReactNode]> = [
    ['Context only', <ContextRing tokens={82_400} contextWindow={200_000} costUsd={0.42} />],
    ['Meter, fresh session', <ContextRing tokens={0} contextWindow={200_000} costUsd={0} usage={meter(claude)} />],
    ['Meter + context', <ContextRing tokens={82_400} contextWindow={200_000} costUsd={0.42} usage={meter(claude)} />],
    ['Codex, 5h nearly spent', <ContextRing tokens={30_000} contextWindow={272_000} costUsd={0} usage={meter(codex)} />],
    ['Grok, red', <ContextRing tokens={0} contextWindow={null} costUsd={0} usage={meter(grok)} />],
    ['Live warning', <ContextRing tokens={82_400} contextWindow={200_000} costUsd={0.42}
      usage={meter(claude, { rateLimit: { status: 'allowed_warning', utilization: 0.9, resetsAt: inSeconds(1800) } })} />],
    ['Live rejection, no reading', <ContextRing tokens={0} contextWindow={null} costUsd={0}
      usage={meter(null, { rateLimit: { status: 'rejected', resetsAt: inSeconds(3600) } })} />],
    ['Refreshing', <ContextRing tokens={0} contextWindow={null} costUsd={0} usage={meter(grok, { refreshing: true })} />],
  ]
  const panels: Array<[string, RemoteUsage | null, UsageMeterProps['rateLimit']]> = [
    ['Claude · three windows + extra usage', claude, null],
    ['Codex · reset credits + account stats', codex, null],
    ['Grok · stale reading + credit balance', grok, null],
    ['GLM gateway', glm, null],
    ['Live warning above the windows', claude, { status: 'allowed_warning', utilization: 0.9, resetsAt: inSeconds(1800) }],
    ['Rejection with no polled reading', null, { status: 'rejected', resetsAt: inSeconds(3600) }],
  ]
  const heading = (text: string) => <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{text}</Text>
  return <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
    {heading('Chips · tap any for its panel')}
    {chips.map(([label, chip]) => <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 200 }}><Text style={{ fontSize: 12, color: colors.foreground }}>{label}</Text></View>
      {chip}
    </View>)}
    {panels.map(([label, usage, rateLimit]) => <View key={label} style={{ gap: 6 }}>
      {heading(label)}
      <View style={{ width: 280, padding: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
        <UsagePanel usage={usage} rateLimit={rateLimit} onConsumeResetCredit={async () => 'reset'} />
      </View>
    </View>)}
  </ScrollView>
}
