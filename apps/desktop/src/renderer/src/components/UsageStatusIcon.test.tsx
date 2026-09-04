/** @vitest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react'
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
    codexThreadId: null as string | null,
    sessionState,
    chatState: {
      activeProject: '/tmp/project',
      harnessResources: { claude: { account: { apiProvider: 'firstParty' } } },
    },
  }
})

vi.mock('@/stores/chat', () => ({
  getLatestCodexThreadId: () => hoisted.codexThreadId ?? undefined,
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
      if (key === 'usageGauge.threadTokens') return 'Thread Tokens'
      if (key === 'usageGauge.estimatedCredits') return 'Estimated Credits'
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
    hoisted.sessionState.apiProviderId = null
    hoisted.sessionState._activeSessionId = 'session-a'
    hoisted.sessionState.session = null
    hoisted.codexThreadId = null
    vi.stubGlobal('app', {
      acpGetRateLimits: vi.fn(async () => null),
      claudeListAccounts: vi.fn(async () => [
        { credentialDir: null, loggedIn: true, identityKey: 'me@example.com|org-a', email: 'me@example.com', orgId: 'org-a', orgName: 'Personal', subscriptionType: 'max', projectsDirectory: null },
      ]),
      claudeGetRateLimits: vi.fn(async () => ({
        planType: 'pro',
        windows: [{ label: '5h', usedPercent: 82, resetsAt: Math.floor(Date.now() / 1000) + 3600 }],
        fetchedAt: Date.now(),
        extraUsage: null,
      })),
      codexGetRateLimits: vi.fn(async () => null),
      codexGetAccountUsage: vi.fn(async () => null),
      codexGetAccountStatus: vi.fn(async () => ({ signedIn: true, email: 'me@openai.test', authMode: 'chatgpt', planType: 'plus' })),
      providerGetRateLimits: vi.fn(async () => null),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('names the ChatGPT account in the Codex gauge, but not when a third-party key is in use', async () => {
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    ;(window.app.codexGetRateLimits as ReturnType<typeof vi.fn>).mockResolvedValue({
      planType: 'plus',
      primary: { windowDurationMins: 300, usedPercent: 40, resetsAt: null },
      secondary: null,
    })

    const { unmount } = render(<UsageStatusIcon />)
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('60%').closest('button')!)
      await Promise.resolve()
    })
    expect(screen.getByText('me@openai.test')).toBeInTheDocument()
    unmount()

    // An apiProviderId means the turn bills a third-party key — naming the OAuth account there
    // would point at a subscription this session never touches.
    hoisted.sessionState.apiProviderId = 'cred_01H8XYZ'
    render(<UsageStatusIcon />)
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('60%').closest('button')!)
      await Promise.resolve()
    })
    expect(screen.queryByText('me@openai.test')).toBeNull()
  })

  it('gives the icon-only gauge trigger an accessible name', async () => {
    // The title slot now renders brand artwork, so the translated string is the only thing left
    // that names this control for a screen reader.
    render(<UsageStatusIcon />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: 'Claude Usage' })).toBeInTheDocument()
  })

  it('names the account in the popover even when only one is signed in', async () => {
    // The default domain's identity changes whenever the user runs `claude /login` in their own
    // terminal, so "only one account" does not mean "no need to say which one".
    render(<UsageStatusIcon />)
    await act(async () => {
      await Promise.resolve()
    })

    // fireEvent, not userEvent: this suite runs on fake timers, which deadlock user-event and
    // every findBy*/waitFor helper.
    await act(async () => {
      // The gauge trigger carries the remaining-percent badge (82% used -> 18% left).
      fireEvent.click(screen.getByText('18%').closest('button')!)
      await Promise.resolve()
    })

    expect(screen.getByText('me@example.com')).toBeInTheDocument()
  })

  it('keeps the first-party gauge when the session runs on a non-default Claude account', async () => {
    // A Claude account carries an apiProviderId, so a "has an id means third-party" gate would
    // route it to providerGetRateLimits — an endpoint it has no entry in — and drop the gauge.
    hoisted.sessionState.apiProviderId = 'claude-account:/domains/work'

    render(<UsageStatusIcon />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(window.app.claudeGetRateLimits).toHaveBeenCalledWith(false, '/domains/work')
    expect(window.app.providerGetRateLimits).not.toHaveBeenCalled()
  })

  it('still routes a third-party credential id to the provider gauge', async () => {
    hoisted.sessionState.apiProviderId = 'cred_01H8XYZ'

    render(<UsageStatusIcon />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(window.app.providerGetRateLimits).toHaveBeenCalled()
    expect(window.app.claudeGetRateLimits).not.toHaveBeenCalled()
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

  it('retries Grok billing after the first empty prewarm fetch', async () => {
    hoisted.sessionState.sessionProvider = 'acp'
    hoisted.sessionState.preferredProvider = 'acp'
    hoisted.sessionState.acpAgentId = 'grok-build'
    const payload = {
      title: 'Grok Build',
      planType: 'SuperGrok Heavy',
      windows: [{ label: 'Weekly limit', usedPercent: 0, resetsAt: null }],
      extraUsage: null,
      fetchedAt: Date.now(),
    }
    const acpGetRateLimits = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(payload)
    vi.stubGlobal('app', { acpGetRateLimits })

    render(<UsageStatusIcon />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByText('Grok Build')).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(2_000)
      await Promise.resolve()
    })

    expect(acpGetRateLimits).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Grok Build')).toBeInTheDocument()
    expect(screen.getByText('SuperGrok Heavy')).toBeInTheDocument()
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

  it('requests and renders per-thread Codex usage', async () => {
    hoisted.sessionState.sessionProvider = 'codex'
    hoisted.sessionState.preferredProvider = 'codex'
    hoisted.codexThreadId = 'thread-1'
    const codexGetAccountUsage = vi.fn(async () => ({
      lifetimeTokens: null,
      peakDailyTokens: null,
      longestRunningTurnSec: null,
      currentStreakDays: null,
      longestStreakDays: null,
      threadUsage: {
        threadId: 'thread-1',
        estimatedUsageCreditsMicros: 12,
        estimatedUsageUsdMicros: null,
        groups: [{ model: 'gpt-next', reasoningEffort: 'ultra', speed: 'fast', estimatedUsageCreditsMicros: 12, netNewInputTokens: null, cachedInputTokens: null, inputTokens: null, outputTokens: null, totalTokens: 56 }],
      },
    }))
    vi.stubGlobal('app', {
      ...window.app,
      codexGetRateLimits: vi.fn(async () => ({
        title: 'Codex', planType: 'pro', primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: null }, secondary: null,
      })),
      codexGetAccountUsage,
    })

    render(<UsageStatusIcon />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(codexGetAccountUsage).toHaveBeenCalledWith('/tmp/project', null, 'thread-1')
    expect(screen.getByText('Thread Tokens')).toBeInTheDocument()
    expect(screen.getByText('Estimated Credits')).toBeInTheDocument()
  })
})
