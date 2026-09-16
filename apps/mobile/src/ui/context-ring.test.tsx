import { expect, jest, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import type { RemoteUsage } from '@superone/shared/agent-types'
import { renderWithTheme } from '../test-render'
import { ContextRing, ContextRingPanel } from './context-ring'

const claude: RemoteUsage = {
  kind: 'claude', title: 'Claude', account: 'a@x.io', planType: 'Max 5x', extraUsage: null, fetchedAt: Date.now(),
  windows: [{ label: '5h', usedPercent: 37, resetsAt: null }, { label: 'Weekly', usedPercent: 12, resetsAt: null }],
}

test('a fresh session with no reading still draws the chip, and tapping it asks the owner to read', async () => {
  const onOpen = jest.fn()
  await renderWithTheme(<ContextRing tokens={0} contextWindow={200_000} costUsd={0} usage={{ usage: null, onOpen }} />)
  fireEvent.press(screen.getByLabelText('Usage'))
  expect(onOpen).toHaveBeenCalledTimes(1)
})

test('the panel says the meter is empty instead of hiding the section', async () => {
  await renderWithTheme(<ContextRingPanel tokens={0} contextWindow={200_000} costUsd={0} usage={{ usage: null }} />)
  expect(screen.getByText('No usage data yet')).toBeTruthy()
  expect(screen.queryByText('Context')).toBeNull()
})

test('without a meter the empty chip is the context ring alone', async () => {
  await renderWithTheme(<ContextRing tokens={0} contextWindow={null} costUsd={0} />)
  expect(screen.getByLabelText('Context')).toBeTruthy()
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
