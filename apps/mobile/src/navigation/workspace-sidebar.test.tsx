import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { WorkspaceSidebar, type WorkspaceSidebarProps } from './workspace-sidebar'
import type { SessionListRow } from '../session-list-state'

const seed: SessionListRow[] = [{ sessionId: 's1', title: 'Fix the drawer' }]
const noop = () => {}
const confirmed = () => Promise.resolve(true)

/** `client: null` is the offline path: the seed is the whole list, no request. */
const sidebar = (overrides: Partial<WorkspaceSidebarProps> = {}) => (
  <WorkspaceSidebar
    client={null}
    projects={[{ path: '/repo', name: 'repo' }, { path: '/other', name: 'other' }]}
    activeProject={{ path: '/repo', name: 'repo' }}
    activeSessionId="s1"
    sessions={seed}
    listRevision={0}
    onNewSession={noop}
    onOpenSession={noop}
    onPinSession={confirmed}
    onArchiveSession={confirmed}
    onDeleteSession={confirmed}
    onSearch={noop}
    onAddProject={noop}
    deviceName="Studio"
    deviceStatus="connectedLan"
    onDisconnect={noop}
    onOpenSettings={noop}
    {...overrides}
  />
)

test('lists every project, not just the one the session is in', async () => {
  await renderWithTheme(sidebar())

  // The whole point of the landscape pane: a phone turned sideways used to get a
  // single project's sessions here, so switching projects meant opening the
  // drawer on top of the list that was already on screen.
  expect(screen.getByText('repo')).toBeTruthy()
  expect(screen.getByText('other')).toBeTruthy()
})

test('opens the active project and leaves the rest collapsed', async () => {
  await renderWithTheme(sidebar())

  expect(screen.getByText('Fix the drawer')).toBeTruthy()
})

test('carries the drawer’s search, add-project and device readout', async () => {
  await renderWithTheme(sidebar())

  // Title case is what `t()` returns for `en`; asserting on it also proves these
  // go through the dictionary rather than carrying hard-coded strings.
  expect(screen.getByText('Search Sessions')).toBeTruthy()
  expect(screen.getByLabelText('Add Project')).toBeTruthy()
  expect(screen.getByLabelText('New Session')).toBeTruthy()
  expect(screen.getByText('Studio')).toBeTruthy()
})

test('puts search and new session above the device readout', async () => {
  await renderWithTheme(sidebar())

  const tree = JSON.stringify(screen.toJSON())
  expect(tree.indexOf('workspace-session-actions')).toBeLessThan(tree.indexOf('sidebar-device-footer'))
  expect(tree.indexOf('Search Sessions')).toBeLessThan(tree.indexOf('Studio'))
})

test('reports reconnecting under the device name, not in the project list', async () => {
  await renderWithTheme(sidebar({
    deviceStatus: 'connecting',
    reconnect: { attempting: true, waiting: false, delayMs: 500, nextAtMs: null },
  }))

  expect(screen.getByText('Studio')).toBeTruthy()
  expect(screen.getByText('Reconnecting…')).toBeTruthy()
  expect(screen.getByText('Fix the drawer')).toBeTruthy()
  expect(screen.queryByText(/not connected/i)).toBeNull()
})
