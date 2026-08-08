import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState, type ReactNode } from 'react'
import { Settings, Wifi } from 'lucide-react'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import {
  createDefaultPerSessionState,
  createDefaultProjectState,
  useChatStore,
} from '@/stores/chat'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { UsageStatusIcon } from './UsageStatusIcon'

/** Must match `.storybook/preview.tsx` applyHarness() so the global harness toolbar does not stomp a different project key. */
const SB_PROJECT = '__storybook__'
const SB_SESSION = 'sb'

type RateLimitTipSeed = {
  status: 'allowed_warning' | 'rejected'
  utilization?: number
  resetsAt?: number
} | null

function mockRateLimitIpc(): void {
  mockIpc('app', 'claudeGetRateLimits', async () => ({
    planType: 'Max',
    windows: [
      { label: '5h', usedPercent: 82, resetsAt: Math.floor(Date.now() / 1000) + 3 * 3600 },
      { label: '7d', usedPercent: 41, resetsAt: Math.floor(Date.now() / 1000) + 4 * 24 * 3600 },
    ],
    extraUsage: { usedDollars: 1.2, limitDollars: 25 },
    fetchedAt: Date.now(),
  }))
  mockIpc('app', 'codexGetRateLimits', async () => null)
  mockIpc('app', 'codexGetAccountUsage', async () => null)
  mockIpc('app', 'providerGetRateLimits', async () => null)
}

function seedSession(rateLimitInfo: RateLimitTipSeed): void {
  mockRateLimitIpc()
  const session = {
    ...createDefaultPerSessionState(),
    preferredProvider: 'claude' as const,
    sessionProvider: 'claude' as const,
    apiProviderId: null,
    status: 'idle' as const,
    rateLimitInfo,
  }
  const project = createDefaultProjectState()
  project._activeSessionId = SB_SESSION
  project._sessions = { [SB_SESSION]: session }
  useChatStore.setState({
    activeProject: SB_PROJECT,
    projectSessions: { [SB_PROJECT]: project },
    harnessResources: {
      ...useChatStore.getState().harnessResources,
      claude: {
        models: useChatStore.getState().harnessResources.claude?.models ?? [],
        account: { apiProvider: 'firstParty' },
        slashCommands: [],
        skills: [],
        commands: [],
        agents: [],
        outputStyles: [],
      } as never,
    },
  })
}

function fireTip(status: 'allowed_warning' | 'rejected'): RateLimitTipSeed {
  return {
    status,
    utilization: status === 'rejected' ? 1 : 0.82 + Math.random() * 0.05,
    resetsAt: Math.floor(Date.now() / 1000) + 3600 + Math.floor(Math.random() * 10_000),
  }
}

function SidebarFooterMock({ children }: { children: ReactNode }) {
  return (
    <div className="w-[240px] overflow-visible rounded-lg border border-border bg-sidebar text-sidebar-foreground">
      <div className="border-b border-border/60 px-3 py-2 text-[11px] font-medium text-muted-foreground">
        Sessions
      </div>
      <div className="flex min-h-[200px] flex-col gap-1.5 p-2">
        <div className="h-7 rounded-md bg-sidebar-accent/80" />
        <div className="h-7 rounded-md bg-muted/40" />
        <div className="h-7 rounded-md bg-muted/40" />
      </div>
      <div className="flex items-center gap-1 overflow-visible border-t border-border/60 px-2 py-2">
        <IconButton size="sm" tooltip="Settings">
          <Settings />
        </IconButton>
        <IconButton size="sm" tooltip="Remote">
          <Wifi />
        </IconButton>
        <div className="relative overflow-visible">{children}</div>
      </div>
    </div>
  )
}

function Playground({ initial = null }: { initial?: RateLimitTipSeed }) {
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitTipSeed>(initial)
  const [mountKey, setMountKey] = useState(0)
  const [statusLine, setStatusLine] = useState('Idle — click a button to fire a tip')

  // Keep store in sync with local tip state. Remount UsageStatusIcon so auto-dismiss
  // local state resets on each fire (same rateLimitInfo identity can reappear).
  useEffect(() => {
    seedSession(rateLimitInfo)
  }, [rateLimitInfo, mountKey])

  // preview.tsx applyHarness() rewrites the active session when the harness toolbar
  // changes — re-assert our seed so buttons keep working.
  useEffect(() => {
    return useChatStore.subscribe((s, prev) => {
      const session = s.projectSessions[SB_PROJECT]?._sessions?.[SB_SESSION]
      const prevSession = prev.projectSessions[SB_PROJECT]?._sessions?.[SB_SESSION]
      if (!session) {
        seedSession(rateLimitInfo)
        return
      }
      // Harness toolbar rebuilt the session without our rateLimitInfo.
      if (session !== prevSession && session.rateLimitInfo !== rateLimitInfo) {
        seedSession(rateLimitInfo)
      }
    })
  }, [rateLimitInfo])

  const trigger = (status: 'allowed_warning' | 'rejected') => {
    const next = fireTip(status)
    setRateLimitInfo(next)
    setMountKey((k) => k + 1)
    setStatusLine(
      status === 'rejected'
        ? 'Fired rejected — tip + red gauge for 6s'
        : 'Fired warning — tip + amber gauge for 6s',
    )
  }

  const clear = () => {
    setRateLimitInfo(null)
    setMountKey((k) => k + 1)
    setStatusLine('Cleared rateLimitInfo')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md border border-border bg-background px-2.5 py-1 text-xs hover:bg-muted"
          onClick={() => trigger('allowed_warning')}
        >
          Fire warning tip
        </button>
        <button
          type="button"
          className="rounded-md border border-border bg-background px-2.5 py-1 text-xs hover:bg-muted"
          onClick={() => trigger('rejected')}
        >
          Fire rejected tip
        </button>
        <button
          type="button"
          className="rounded-md border border-border bg-background px-2.5 py-1 text-xs hover:bg-muted"
          onClick={clear}
        >
          Clear
        </button>
      </div>
      <p className="max-w-md text-xs text-muted-foreground">
        Tip auto-dismisses after 6s; gauge highlight clears with it. Use the toolbar language switch for zh/en.
      </p>
      <p className="text-xs font-medium tabular-nums text-foreground">{statusLine}</p>
      <SidebarFooterMock>
        <UsageStatusIcon key={mountKey} />
      </SidebarFooterMock>
    </div>
  )
}

const meta: Meta = {
  title: 'Sidebar/UsageStatusIcon',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Sidebar usage gauge with Claude rate-limit tip (6s auto-dismiss). Tip lives on the gauge, not in chat transcript.',
      },
    },
  },
}

export default meta
type Story = StoryObj

/** Idle gauge only — open popover to inspect windows. */
export const IdleGauge: Story = {
  name: 'Idle gauge',
  render: () => <Playground />,
}

/** Approaching limit tip + amber highlight for 6s. */
export const ApproachingRateLimit: Story = {
  name: 'Approaching rate limit',
  render: () => (
    <Playground
      initial={{
        status: 'allowed_warning',
        utilization: 0.82,
        resetsAt: Math.floor(Date.now() / 1000) + 3600,
      }}
    />
  ),
}

/** Hard rate limit tip + red highlight for 6s. */
export const RateLimited: Story = {
  name: 'Rate limited',
  render: () => (
    <Playground
      initial={{
        status: 'rejected',
        utilization: 1,
        resetsAt: Math.floor(Date.now() / 1000) + 7200,
      }}
    />
  ),
}

/** Buttons to re-trigger after auto-dismiss. */
export const Interactive: Story = {
  name: 'Interactive playground',
  render: () => <Playground />,
}
