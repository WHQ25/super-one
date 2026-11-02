import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { SettledSessionSection } from './settled-session-section'

const noop = () => {}
const session = { sessionId: 'done', title: 'Finished thread' }

test('renders nothing when the project has no settled sessions', async () => {
  await renderWithTheme(
    <SettledSessionSection rows={[]} total={0} open={false} onToggle={noop} onOpenSession={noop} onSettleSession={noop} onDeleteSession={noop} />,
  )
  expect(screen.queryByTestId('settled-session-section')).toBeNull()
})

test('keeps rows unmounted until the heading is opened, and shows the total while folded', async () => {
  const onToggle = jest.fn()
  await renderWithTheme(
    <SettledSessionSection rows={[session]} total={12} open={false} onToggle={onToggle} onOpenSession={noop} onSettleSession={noop} onDeleteSession={noop} />,
  )
  expect(screen.queryByText('Finished thread')).toBeNull()
  expect(screen.getByText('12')).toBeTruthy()
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Settled, 12' })) })
  expect(onToggle).toHaveBeenCalledTimes(1)
})

test('scrolls the loaded rows while open, without a Show more control', async () => {
  await renderWithTheme(
    <SettledSessionSection
      rows={[session]} total={12} open hasMore onLoadMore={noop} onToggle={noop}
      onOpenSession={noop} onSettleSession={noop} onDeleteSession={noop}
    />,
  )
  expect(screen.getByText('Finished thread')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Show More Settled Sessions' })).toBeNull()
  expect(screen.queryByText('Show More')).toBeNull()
  expect(screen.queryByText('12')).toBeNull()
})

test('shows the failure instead of an empty group', async () => {
  await renderWithTheme(
    <SettledSessionSection
      rows={[]} total={0} open={false} error="Could not load settled sessions" onToggle={noop}
      onOpenSession={noop} onSettleSession={noop} onDeleteSession={noop}
    />,
  )
  expect(screen.getByText('Could not load settled sessions')).toBeTruthy()
})
