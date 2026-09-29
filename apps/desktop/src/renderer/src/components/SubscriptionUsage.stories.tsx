import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo, useState } from 'react'
import type { ClaudeRateLimits } from '@superone/shared/agent-types'
import { SubscriptionUsageTracker } from '@superone/shared/subscription-usage'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { UsageStatusIcon } from './UsageStatusIcon'
import { WindowBar } from './provider-usage'
import { subscriptionAlertLedger } from './use-subscription-alert'

type Scenario = 'safe' | 'risk' | 'critical' | 'watch' | 'learning' | 'stale' | 'idle' | 'rejected'

function reading(scenario: Scenario): ClaudeRateLimits {
  const now = Date.now() - (scenario === 'stale' ? 11 * 60_000 : 0)
  const rate = scenario === 'safe' || scenario === 'rejected' ? 5 : scenario === 'critical' ? 40 : 10
  const remaining = scenario === 'critical' ? 10 : 20
  const resetHours = scenario === 'safe' || scenario === 'rejected' ? 0.5 : scenario === 'watch' ? 2 : 48
  const tracker = new SubscriptionUsageTracker()
  let window = tracker.observe('story', { id: 'seven_day', label: 'Weekly', usedPercent: 100 - remaining, resetsAt: now / 1000 + resetHours * 3600 }, now)
  if (scenario !== 'learning') {
    const series = new SubscriptionUsageTracker()
    for (let m = -60; m <= 0; m += 5) {
      window = series.observe('story', { ...window, usedPercent: 100 - remaining + Math.min(m + (scenario === 'idle' ? 25 : 0), 0) / 60 * rate }, now + m * 60_000)
    }
  }
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
      {(['safe', 'risk', 'critical', 'watch', 'learning', 'stale', 'idle', 'rejected'] as Scenario[]).map((value) => <option key={value}>{value}</option>)}
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
export const ResetsBeforeEmpty: Story = { render: () => <Preview initial="safe" /> }
export const RunsOutBeforeReset: Story = { render: () => <Preview initial="risk" /> }
export const AlmostEmpty: Story = { render: () => <Preview initial="critical" /> }
export const Boundary: Story = { render: () => <Preview initial="watch" /> }
export const Learning: Story = { render: () => <Preview initial="learning" /> }
export const Stale: Story = { render: () => <Preview initial="stale" /> }
export const Idle: Story = { render: () => <Preview initial="idle" /> }
export const RejectedDespiteForecast: Story = { render: () => <Preview initial="rejected" /> }
