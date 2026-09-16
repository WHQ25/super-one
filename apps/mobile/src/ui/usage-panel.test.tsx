import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native'
import type { RemoteUsage } from '@superone/shared/agent-types'
import { renderWithTheme } from '../test-render'
import { UsagePanel } from './usage-panel'

const now = Date.now()

const claude: RemoteUsage = {
  kind: 'claude', title: 'Claude', account: 'a@x.io', planType: 'Max 5x', fetchedAt: now - 3 * 60_000,
  extraUsage: { usedDollars: 1.5, limitDollars: 20 },
  windows: [{ label: '5h', usedPercent: 63, resetsAt: Math.round(now / 1000) + 2 * 3600 + 15 * 60 }, { label: 'Weekly', usedPercent: 12, resetsAt: null }],
}

const codex: RemoteUsage = {
  kind: 'codex', title: 'Codex', account: 'c@x.io', planType: 'plus', extraUsage: null, fetchedAt: now,
  windows: [{ label: '5h', usedPercent: 30, resetsAt: null }],
  resetCredits: 1,
  resetCreditList: [{ id: 'rc-1', status: 'available', title: 'Bonus reset', description: null, expiresAt: null }],
  codexAccount: { lifetimeTokens: 1_250_000, peakDailyTokens: 90_000, longestRunningTurnSec: null, currentStreakDays: 4, longestStreakDays: 9 },
}

test('the Claude meter lists every window with its remaining share and reset countdown', async () => {
  await renderWithTheme(<UsagePanel usage={claude} />)
  expect(screen.getByText('5h')).toBeTruthy()
  expect(screen.getByText('37% left')).toBeTruthy()
  expect(screen.getByText('Resets in 2h 15m ·')).toBeTruthy()
  expect(screen.getByText('88% left')).toBeTruthy()
  expect(screen.getByText('Max 5x')).toBeTruthy()
  expect(screen.getByText('a@x.io')).toBeTruthy()
  expect(screen.getByText('$1.50 / $20.00')).toBeTruthy()
  expect(screen.getByText('Updated 3m ago')).toBeTruthy()
})

test('the Codex meter carries its account stats and a redeemable reset credit', async () => {
  const consume = jest.fn(async () => 'reset' as const)
  await renderWithTheme(<UsagePanel usage={codex} onConsumeResetCredit={consume} />)
  expect(screen.getByText('Bonus reset')).toBeTruthy()
  expect(screen.getByText('1.3m')).toBeTruthy()
  expect(screen.getByText('4d')).toBeTruthy()

  await act(async () => { fireEvent.press(screen.getByText('Reset Now')) })
  expect(consume).toHaveBeenCalledWith('rc-1')
  await waitFor(() => expect(screen.getByText('Usage reset')).toBeTruthy())
})

test('the Grok meter wears the Grok brand lockup instead of the globe fallback', async () => {
  const grok: RemoteUsage = {
    kind: 'acp', title: 'Grok Build', account: null, planType: 'SuperGrok', extraUsage: null, fetchedAt: now,
    windows: [{ label: 'Weekly limit', usedPercent: 40, resetsAt: null }],
  }
  await renderWithTheme(<UsagePanel usage={grok} />)
  // The lockup renders the name as artwork and exposes it through the accessibility label.
  expect(screen.getByLabelText('Grok Build')).toBeTruthy()
  expect(screen.queryByText('Grok Build')).toBeNull()
  expect(screen.getByText('SuperGrok')).toBeTruthy()
})

test('a live rejection is spelled out above the windows, and stands alone without a reading', async () => {
  await renderWithTheme(<UsagePanel usage={null} rateLimit={{ status: 'rejected', resetsAt: Math.round(now / 1000) + 600 }} />)
  expect(screen.getByText('Rate limited · Resets in 10m')).toBeTruthy()
})

test('an expired live warning is not shown', async () => {
  await renderWithTheme(<UsagePanel usage={claude} rateLimit={{ status: 'allowed_warning', resetsAt: Math.round(now / 1000) - 5 }} />)
  expect(screen.queryByText(/Approaching limit/)).toBeNull()
})
