import { View } from 'react-native'
import type { RemoteUsage } from '@superone/shared/agent-types'
import { MobileThemeProvider } from '../theme/context'
import { Text } from './text'
import { ContextRing } from './context-ring'
import { UsagePanel, type UsageMeterProps } from './usage-panel'
import { USAGE_FIXTURES, inSeconds } from '../preview/usage-fixtures'

const { claude, codex, grok, glm } = USAGE_FIXTURES

const noop = () => {}
const meter = (usage: RemoteUsage | null, extra: Partial<UsageMeterProps> = {}): UsageMeterProps => ({
  usage, onOpen: noop, onRefresh: noop, onConsumeResetCredit: async () => 'reset', ...extra,
})

function Chip({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
    <View style={{ width: 200 }}><Text style={{ fontSize: 12, opacity: 0.6 }}>{label}</Text></View>
    {children}
  </View>
}

/** Every resting state of the chip, side by side: tap any of them for its panel. */
function Chips() {
  return <MobileThemeProvider>
    <View style={{ padding: 16, gap: 12 }}>
      <Chip label="Context only"><ContextRing tokens={82_400} contextWindow={200_000} costUsd={0.42} /></Chip>
      <Chip label="Context, no window"><ContextRing tokens={82_400} contextWindow={null} costUsd={0.42} /></Chip>
      <Chip label="Meter, fresh session"><ContextRing tokens={0} contextWindow={200_000} costUsd={0} usage={meter(claude)} /></Chip>
      <Chip label="Meter + context"><ContextRing tokens={82_400} contextWindow={200_000} costUsd={0.42} usage={meter(claude)} /></Chip>
      <Chip label="Codex, 5h nearly spent"><ContextRing tokens={30_000} contextWindow={272_000} costUsd={0} usage={meter(codex)} /></Chip>
      <Chip label="Grok, red"><ContextRing tokens={0} contextWindow={null} costUsd={0} usage={meter(grok)} /></Chip>
      <Chip label="Live warning"><ContextRing tokens={82_400} contextWindow={200_000} costUsd={0.42}
        usage={meter(claude, { rateLimit: { status: 'allowed_warning', utilization: 0.9, resetsAt: inSeconds(1800) } })} /></Chip>
      <Chip label="Live rejection, no reading"><ContextRing tokens={0} contextWindow={null} costUsd={0}
        usage={meter(null, { rateLimit: { status: 'rejected', resetsAt: inSeconds(3600) } })} /></Chip>
      <Chip label="No meter, nothing spent (hidden)"><ContextRing tokens={0} contextWindow={200_000} costUsd={0} usage={meter(null)} /></Chip>
    </View>
  </MobileThemeProvider>
}

function Panel({ usage, rateLimit }: { usage: RemoteUsage | null; rateLimit?: UsageMeterProps['rateLimit'] }) {
  return <MobileThemeProvider>
    <View style={{ width: 280, padding: 8 }}>
      <UsagePanel usage={usage} rateLimit={rateLimit} onConsumeResetCredit={async () => 'reset'} />
    </View>
  </MobileThemeProvider>
}

export default {
  title: 'Mobile/ContextRing',
  component: ContextRing,
  render: Chips,
}

export const Chips_ = { name: 'Chips · every resting state' }
export const PanelClaude = { name: 'Panel · Claude, three windows + extra usage', render: () => <Panel usage={claude} /> }
export const PanelCodex = { name: 'Panel · Codex, reset credits + account stats', render: () => <Panel usage={codex} /> }
export const PanelGrok = { name: 'Panel · Grok, stale reading + credit balance', render: () => <Panel usage={grok} /> }
export const PanelGateway = { name: 'Panel · GLM gateway', render: () => <Panel usage={glm} /> }
export const PanelLiveWarning = {
  name: 'Panel · live warning above the windows',
  render: () => <Panel usage={claude} rateLimit={{ status: 'allowed_warning', utilization: 0.9, resetsAt: inSeconds(1800) }} />,
}
export const PanelLiveRejectedAlone = {
  name: 'Panel · rejection with no polled reading',
  render: () => <Panel usage={null} rateLimit={{ status: 'rejected', resetsAt: inSeconds(3600) }} />,
}
export const PanelZh = {
  name: 'Panel · Chinese',
  render: () => <MobileThemeProvider locale="zh">
    <View style={{ width: 280, padding: 8 }}>
      <UsagePanel usage={codex} rateLimit={{ status: 'allowed_warning', utilization: 0.9 }} onConsumeResetCredit={async () => 'noCredit'} />
    </View>
  </MobileThemeProvider>,
}
