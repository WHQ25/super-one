/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => {
  const sessionState = {
    _activeSessionId: 'session-a' as string | null,
    session: null as { sessionId: string } | null,
    sessionProvider: 'claude' as string | null,
    preferredProvider: 'claude' as string | null,
    apiProviderId: null as string | null,
    status: 'idle',
    acpAgentId: null as string | null,
    rateLimitInfo: null as null | {
      status: 'allowed_warning' | 'rejected'
      resetsAt?: number
      rateLimitType?: string
      utilization?: number
    },
  }
  return {
    sessionState,
    chatState: {
      activeProject: '/tmp/project',
      harnessResources: { claude: { account: { apiProvider: 'firstParty' } } },
    },
  }
})

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (s: typeof hoisted.chatState) => unknown) => selector(hoisted.chatState),
  useActiveSession: (selector: (s: typeof hoisted.sessionState) => unknown) => selector(hoisted.sessionState),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'usageGauge.rateLimit.approaching') return 'Approaching rate limit'
      if (key === 'usageGauge.rateLimit.limited') return 'Rate limited'
      if (key === 'usageGauge.rateLimit.percentUsed') return `${opts?.percent}% used`
      if (key === 'usageGauge.rateLimit.resetsAt') return `resets at ${opts?.time}`
      if (key === 'usageGauge.claudeTitle') return 'Claude Usage'
      if (key === 'usageGauge.percentLeft') return `${opts?.percent}% left`
      if (key === 'usageGauge.resetsIn') return `resets in ${opts?.time}`
      if (key === 'usageGauge.resetsSoon') return 'resets soon'
      if (key === 'usageGauge.updatedJustNow') return 'Updated just now'
      if (key === 'usageGauge.updating') return 'Updating…'
      return key
    },
  }),
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
}))

vi.mock('@superone/ui/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverAnchor: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children, side, align, collisionPadding, role }: {
    children: React.ReactNode
    side?: string
    align?: string
    collisionPadding?: number
    role?: string
  }) => (
    <div
      role={role}
      data-slot="popover-content"
      data-side={side}
      data-align={align}
      data-collision-padding={collisionPadding}
    >
      {children}
    </div>
  ),
}))

vi.mock('@superone/ui/components/ui/icon-button', () => ({
  IconButton: ({ children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" className={className} {...props}>{children}</button>
  ),
}))

vi.mock('@superone/ui/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { UsageStatusIcon } from './UsageStatusIcon'

describe('UsageStatusIcon rate-limit tip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    hoisted.sessionState.rateLimitInfo = null
    hoisted.sessionState.status = 'idle'
    hoisted.sessionState.sessionProvider = 'claude'
    hoisted.sessionState.preferredProvider = 'claude'
    hoisted.sessionState.acpAgentId = null
    hoisted.sessionState._activeSessionId = 'session-a'
    hoisted.sessionState.session = null
    vi.stubGlobal('app', {
      acpGetRateLimits: vi.fn(async () => null),
      claudeGetRateLimits: vi.fn(async () => ({
        planType: 'pro',
        windows: [{ label: '5h', usedPercent: 82, resetsAt: Math.floor(Date.now() / 1000) + 3600 }],
        fetchedAt: Date.now(),
        extraUsage: null,
      })),
      codexGetRateLimits: vi.fn(async () => null),
      codexGetAccountUsage: vi.fn(async () => null),
      providerGetRateLimits: vi.fn(async () => null),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows tip from rateLimitInfo and auto-dismisses after 6s without residual highlight', async () => {
    const { rerender } = render(<UsageStatusIcon />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByRole('status')).toBeNull()

    hoisted.sessionState.rateLimitInfo = {
      status: 'allowed_warning',
      utilization: 0.82,
      resetsAt: Math.floor(Date.now() / 1000) + 3600,
    }
    rerender(<UsageStatusIcon />)

    expect(screen.getByRole('status')).toHaveTextContent('Approaching rate limit')
    expect(screen.getByRole('status')).toHaveTextContent('82% used')

    await act(async () => {
      vi.advanceTimersByTime(6_000)
    })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('anchors the tip above the gauge, end-aligned', async () => {
    hoisted.sessionState.rateLimitInfo = {
      status: 'allowed_warning',
      utilization: 0.82,
    }

    render(<UsageStatusIcon />)
    await act(async () => {
      await Promise.resolve()
    })

    const tip = screen.getByRole('status')
    expect(tip).toHaveAttribute('data-side', 'top')
    expect(tip).toHaveAttribute('data-align', 'end')
  })

  it('shows the tip again for a new episode after the limit clears', async () => {
    const rejected = { status: 'rejected' as const, rateLimitType: 'api' }
    hoisted.sessionState.rateLimitInfo = rejected
    const { rerender } = render(<UsageStatusIcon />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole('status')).toHaveTextContent('Rate limited')

    await act(async () => {
      vi.advanceTimersByTime(6_000)
    })
    expect(screen.queryByRole('status')).toBeNull()

    // A served turn ends the episode…
    hoisted.sessionState.rateLimitInfo = null
    rerender(<UsageStatusIcon />)
    expect(screen.queryByRole('status')).toBeNull()

    // …so hitting the same limit later is a new episode, not a stale duplicate.
    hoisted.sessionState.rateLimitInfo = { ...rejected }
    rerender(<UsageStatusIcon />)
    expect(screen.getByRole('status')).toHaveTextContent('Rate limited')
  })

  it('does not re-tip the same episode after switching sessions and back', async () => {
    const warning = {
      status: 'allowed_warning' as const,
      utilization: 0.82,
      resetsAt: Math.floor(Date.now() / 1000) + 3600,
    }
    hoisted.sessionState.rateLimitInfo = warning
    const { rerender } = render(<UsageStatusIcon />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole('status')).toHaveTextContent('Approaching rate limit')

    await act(async () => {
      vi.advanceTimersByTime(6_000)
    })
    expect(screen.queryByRole('status')).toBeNull()

    // Switch to another session with no rate-limit state (clears active info).
    hoisted.sessionState._activeSessionId = 'session-b'
    hoisted.sessionState.rateLimitInfo = null
    rerender(<UsageStatusIcon />)
    expect(screen.queryByRole('status')).toBeNull()

    // Return to the original session — same episode must not reappear.
    hoisted.sessionState._activeSessionId = 'session-a'
    hoisted.sessionState.rateLimitInfo = warning
    rerender(<UsageStatusIcon />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('hides tips whose resetsAt has already elapsed', async () => {
    hoisted.sessionState.rateLimitInfo = {
      status: 'rejected',
      resetsAt: Math.floor(Date.now() / 1000) - 60,
    }
    render(<UsageStatusIcon />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders the Grok credits gauge from acpGetRateLimits', async () => {
    hoisted.sessionState.sessionProvider = 'acp'
    hoisted.sessionState.preferredProvider = 'acp'
    hoisted.sessionState.acpAgentId = 'grok-build'
    vi.stubGlobal('app', {
      acpGetRateLimits: vi.fn(async () => ({
        title: 'Grok Build',
        planType: 'SuperGrok Heavy',
        windows: [{ label: 'Weekly limit', usedPercent: 100, resetsAt: null }],
        extraUsage: null,
        creditBalanceDollars: 12.34,
        fetchedAt: Date.now(),
      })),
    })

    render(<UsageStatusIcon />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByText('Grok Build')).toBeInTheDocument()
    expect(screen.getByText('SuperGrok Heavy')).toBeInTheDocument()
    expect(screen.getByText('Weekly limit')).toBeInTheDocument()
    // Fully spent pool reads as 0% left, and the badge mirrors it.
    expect(screen.getAllByText('0% left').length).toBeGreaterThan(0)
    expect(screen.getByText('$12.34')).toBeInTheDocument()
  })

  it('stays hidden for a non-Grok ACP agent with no billing surface', async () => {
    hoisted.sessionState.sessionProvider = 'acp'
    hoisted.sessionState.preferredProvider = 'acp'
    hoisted.sessionState.acpAgentId = 'opencode'
    const acpGetRateLimits = vi.fn(async () => null)
    vi.stubGlobal('app', { acpGetRateLimits })

    render(<UsageStatusIcon />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(acpGetRateLimits).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows rejected tip copy', async () => {
    hoisted.sessionState.rateLimitInfo = {
      status: 'rejected',
      resetsAt: Math.floor(Date.now() / 1000) + 7200,
    }
    render(<UsageStatusIcon />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByRole('status')).toHaveTextContent('Rate limited')
  })
})
