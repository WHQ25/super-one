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

test('shows the running worktree path under the session title', async () => {
  await renderWithTheme(header({
    route: 'chat',
    title: 'Session',
    hasSession: true,
    worktreePath: '/repo/.worktrees/fix-relay',
    git: { kind: 'worktreeBranch', branch: 'fix-relay' },
  }))

  expect(screen.getByText('Session')).toBeTruthy()
  expect(screen.getByText('/repo/.worktrees/fix-relay')).toBeTruthy()
  expect(screen.getByText('fix-relay')).toBeTruthy()
  expect(screen.queryByText('super-one')).toBeNull()
})

test('dots the workspace menu when sessions need attention', async () => {
  await renderWithTheme(header({
    route: 'chat',
    title: 'Session',
    hasSession: true,
    pendingCount: 2,
  }))

  expect(screen.getByTestId('workspace-pending-badge')).toBeTruthy()
  expect(screen.queryByText('2')).toBeNull()
  expect(screen.getByRole('button', { name: 'Open Workspace, Sessions Need Attention' })).toBeTruthy()
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
  expect(mobileHeaderTitle('terminal', 'super-one', 'New session', 'npm run dev', t)).toBe('npm run dev')
})

test('files puts search, upload and new folder in a trailing menu', async () => {
  await renderWithTheme(header({
    files: {
      kind: 'project',
      finderOpen: false,
      onToggleFinder: noop,
      onUploadFile: noop,
      onNewFolder: noop,
    },
  }))

  expect(screen.getByLabelText('File Actions')).toBeTruthy()
  expect(screen.queryByLabelText('Search Files')).toBeNull()
})

test('files replaces the menu with close while search is open', async () => {
  await renderWithTheme(header({
    files: {
      kind: 'project',
      finderOpen: true,
      onToggleFinder: () => {},
      onUploadFile: () => {},
      onNewFolder: () => {},
    },
  }))

  expect(screen.getByLabelText('Close Search')).toBeTruthy()
  expect(screen.queryByLabelText('File Actions')).toBeNull()
})

test('puts terminal tabs in a trailing menu instead of a tab row', async () => {
  await renderWithTheme(header({
    route: 'terminal',
    title: 'npm run dev',
    hasSession: true,
    git: { kind: 'branch', branch: 'main', dirtyFiles: 0 },
    terminal: {
      tabs: [
        { terminalId: 'a', title: 'npm run dev', status: 'running' },
        { terminalId: 'b', title: 'vim', status: 'running' },
      ],
      activeId: 'a',
      onSelect: noop,
      onCreate: noop,
      onClose: noop,
    },
  }))

  expect(screen.getByText('npm run dev')).toBeTruthy()
  expect(screen.getByLabelText('Terminal Actions')).toBeTruthy()
  expect(screen.queryByRole('tab')).toBeNull()
  expect(screen.queryByText('vim')).toBeNull()
  expect(screen.queryByText('super-one')).toBeNull()
  expect(screen.queryByText('main')).toBeNull()
})
