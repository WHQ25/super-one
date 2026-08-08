/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => {
  const sessionState = {
    sessionProvider: 'claude' as string | null,
    preferredProvider: 'claude' as string | null,
    apiProviderId: null as string | null,
    status: 'idle',
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
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
    vi.stubGlobal('app', {
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
