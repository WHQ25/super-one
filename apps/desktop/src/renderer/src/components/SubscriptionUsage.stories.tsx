import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo, useState } from 'react'
import type { ClaudeRateLimits } from '@superone/shared/agent-types'
import { SubscriptionUsageTracker } from '@superone/shared/subscription-usage'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { UsageStatusIcon } from './UsageStatusIcon'
import { WindowBar } from './provider-usage'
import { subscriptionAlertLedger } from './use-subscription-alert'

type Scenario = 'safe' | 'risk' | 'critical' | 'watch' | 'learning' | 'average' | 'stale' | 'quiet' | 'rejected'

function reading(scenario: Scenario): ClaudeRateLimits {
  const now = Date.now() - (scenario === 'stale' ? 11 * 60_000 : 0)
  const weekly = scenario === 'safe' || scenario === 'rejected' || scenario === 'risk'
  const duration = weekly ? 7 * 24 * 60 : 300
  const resetHours = scenario === 'risk' ? 48 : weekly ? 0.5 : 3
  const usedPercent = scenario === 'critical' ? 95 : scenario === 'watch' ? 38 : scenario === 'risk' ? 90 : weekly ? 80 : 60
  const tracker = new SubscriptionUsageTracker()
  const input = { id: weekly ? 'seven_day' : 'five_hour', label: weekly ? 'Weekly' : '5h',
    windowDurationMins: scenario === 'learning' ? null : duration, usedPercent, resetsAt: now / 1000 + resetHours * 3600 }
  if (scenario !== 'average') tracker.observe('story', input, now - 5 * 60_000)
  const window = tracker.observe('story', input, now)
  return { quotaKey: 'story-account', planType: 'Max', fetchedAt: now, extraUsage: null, windows: [window] }
}

function Preview({ initial = 'safe' }: { initial?: Scenario }) {
  const [scenario, setScenario] = useState(initial)
  const [ready, setReady] = useState(false)
  const limits = useMemo(() => reading(scenario), [scenario])
  useEffect(() => {
    subscriptionAlertLedger.clear()
    mockIpc('app', 'claudeGetRateLimits', async () => limits)
    mockIpc('app', 'claudeListAccounts', async () => [{ credentialDir: null, loggedIn: true, email: 'demo@example.com', identityKey: 'demo|personal' }])
    const project = createDefaultProjectState()
    project._activeSessionId = 'sb'
    project._sessions = { sb: { ...createDefaultPerSessionState(), preferredProvider: 'claude', sessionProvider: 'claude', status: 'idle', selectedModel: 'claude-sonnet',
      rateLimitInfo: scenario === 'safe' || scenario === 'rejected'
        ? { status: scenario === 'rejected' ? 'rejected' : 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.8, resetsAt: limits.windows[0].resetsAt! }
        : null } }
    useChatStore.setState({ activeProject: '__storybook__', projectSessions: { __storybook__: project },
      harnessResources: { ...useChatStore.getState().harnessResources, claude: { models: [], account: { apiProvider: 'firstParty' }, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [] } as never } })
    setReady(true)
  }, [limits, scenario])
  return <div className="flex min-h-screen flex-col items-center gap-8 bg-background p-6 text-foreground">
    <select aria-label="Usage scenario" value={scenario} onChange={(event) => { setReady(false); setScenario(event.target.value as Scenario) }} className="rounded border border-border bg-background p-2 text-sm">
      {(['safe', 'risk', 'critical', 'watch', 'learning', 'average', 'stale', 'quiet', 'rejected'] as Scenario[]).map((value) => <option key={value}>{value}</option>)}
    </select>
    <div className="w-full max-w-80 rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div className="mb-3 text-sm font-medium">Claude · Max</div>
      {limits.windows.map((window) => <WindowBar key={window.id} {...window} />)}
    </div>
    <div className="flex w-full max-w-80 justify-end pt-24">{ready && <UsageStatusIcon key={scenario} />}</div>
  </div>
}

const meta: Meta = { title: 'Sidebar/SubscriptionUsage', parameters: { layout: 'fullscreen' } }
export default meta
type Story = StoryObj
export const ResetsBeforeEmpty: Story = { name: 'Resets before empty (no reassurance copy)', render: () => <Preview initial="safe" /> }
export const RunsOutBeforeReset: Story = { render: () => <Preview initial="risk" /> }
export const AlmostEmpty: Story = { render: () => <Preview initial="critical" /> }
export const Boundary: Story = { render: () => <Preview initial="watch" /> }
export const Learning: Story = { name: 'Missing cycle duration (forecast hidden)', render: () => <Preview initial="learning" /> }
export const CycleAverage: Story = { render: () => <Preview initial="average" /> }
export const ZeroConsumption: Story = { render: () => <div className="max-w-80 bg-background p-4 text-foreground">
  <WindowBar label="5h" usedPercent={0} resetsAt={Date.now() / 1000 + 5 * 3600}
    forecast={{ sampledAt: Date.now(), status: 'learning', ratePerHour: null, exhaustsAt: null, confirmed: false }} />
</div> }
export const Stale: Story = { render: () => <Preview initial="stale" /> }
export const Quiet: Story = { render: () => <Preview initial="quiet" /> }
export const RejectedDespiteForecast: Story = { render: () => <Preview initial="rejected" /> }
