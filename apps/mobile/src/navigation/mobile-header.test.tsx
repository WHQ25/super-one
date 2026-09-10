import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { MobileHeader, mobileHeaderTitle } from './mobile-header'

const noop = () => {}

function header(overrides: Partial<Parameters<typeof MobileHeader>[0]> = {}) {
  return <MobileHeader
    route="files"
    title="Files"
    subtitle="super-one"
    provider="claude"
    deviceStatus="connectedLan"
    onBack={noop}
    onSwitchSession={noop}
    onOpenTerminal={noop}
    onOpenFiles={noop}
    {...overrides}
  />
}

test('shows an offline connection on the second line of every native header', async () => {
  await renderWithTheme(header({ deviceStatus: 'offline' }))

  expect(screen.getByText('Files')).toBeTruthy()
  expect(screen.getByText('Offline')).toBeTruthy()
})

test('shows reconnecting under the session title', async () => {
  await renderWithTheme(header({
    route: 'chat',
    title: 'Session',
    hasSession: true,
    deviceStatus: 'connecting',
    reconnect: { attempting: true, waiting: false, delayMs: 500, nextAtMs: null },
  }))

  expect(screen.getByText('Session')).toBeTruthy()
  expect(screen.getByText('Reconnecting…')).toBeTruthy()
})

test('leaves connection feedback to the persistent sidebar on tablet', async () => {
  await renderWithTheme(header({
    route: 'chat',
    title: 'Session',
    hasSession: true,
    deviceStatus: 'offline',
    sidebarVisible: true,
  }))

  expect(screen.getByText('super-one')).toBeTruthy()
  expect(screen.queryByText('Offline')).toBeNull()
})

test('does not duplicate reconnecting in the header while the sidebar is visible', async () => {
  await renderWithTheme(header({
    route: 'chat',
    title: 'Session',
    hasSession: true,
    deviceStatus: 'connecting',
    reconnect: { attempting: true, waiting: false, delayMs: 500, nextAtMs: null },
    sidebarVisible: true,
  }))

  expect(screen.getByText('super-one')).toBeTruthy()
  expect(screen.queryByText('Reconnecting…')).toBeNull()
})

test('badges the workspace menu with the number of pending requests', async () => {
  await renderWithTheme(header({
    route: 'chat',
    title: 'Session',
    hasSession: true,
    pendingCount: 2,
  }))

  expect(screen.getByTestId('workspace-pending-badge')).toBeTruthy()
  expect(screen.getByText('2')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Open workspace, 2 pending requests' })).toBeTruthy()
})

test('hides the workspace badge when nothing is waiting', async () => {
  await renderWithTheme(header({
    route: 'chat',
    title: 'Session',
    hasSession: true,
    pendingCount: 0,
  }))

  expect(screen.queryByTestId('workspace-pending-badge')).toBeNull()
  expect(screen.getByRole('button', { name: 'Open Workspace' })).toBeTruthy()
})

test('runs the new-session placeholder through the dictionary but leaves real titles alone', () => {
  const t = (source: string) => (source === 'New session' ? 'New Session' : source)

  expect(mobileHeaderTitle('chat', 'super-one', 'New session', '', t)).toBe('New Session')
  expect(mobileHeaderTitle('chat', 'super-one', 'Fix the relay ACK', '', t)).toBe('Fix the relay ACK')
})
