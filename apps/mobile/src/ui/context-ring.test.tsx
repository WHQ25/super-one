import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import type { RemoteUsage } from '@superone/shared/agent-types'
import { renderWithTheme } from '../test-render'
import { ContextRing } from './context-ring'

const claude: RemoteUsage = {
  kind: 'claude', title: 'Claude', account: 'a@x.io', planType: 'Max 5x', extraUsage: null, fetchedAt: Date.now(),
  windows: [{ label: '5h', usedPercent: 37, resetsAt: null }, { label: 'Weekly', usedPercent: 12, resetsAt: null }],
}

test('nothing is drawn before the session spends anything and with no meter', async () => {
  await renderWithTheme(<ContextRing tokens={0} contextWindow={200_000} costUsd={0} usage={{ usage: null }} />)
  expect(screen.queryByTestId('context-ring')).toBeNull()
})

test('a subscription meter alone draws the chip and names the tightest window', async () => {
  await renderWithTheme(<ContextRing tokens={0} contextWindow={200_000} costUsd={0} usage={{ usage: claude }} />)
  expect(screen.getByLabelText('Usage left: 63%')).toBeTruthy()
})

test('with context spent the label carries both rings', async () => {
  await renderWithTheme(<ContextRing tokens={50_000} contextWindow={200_000} costUsd={0.1} usage={{ usage: claude }} />)
  expect(screen.getByLabelText('Usage left: 63%, Context used: 25%')).toBeTruthy()
})

test('a live rate limit keeps the chip on screen even without a polled reading', async () => {
  await renderWithTheme(<ContextRing tokens={0} contextWindow={null} costUsd={0}
    usage={{ usage: null, rateLimit: { status: 'rejected' } }} />)
  expect(screen.getByLabelText('Rate limited')).toBeTruthy()
})
