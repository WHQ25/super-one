import { beforeEach, expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native'
import type { RelayClient } from '@superone/relay-client'
import { renderWithTheme } from '../test-render'
import { WorkspaceSidebar, type WorkspaceSidebarProps } from './workspace-sidebar'
import type { SessionListRow } from '../session-list-state'
import { WorkspaceListCache } from '../workspace-list-cache'

const seed: SessionListRow[] = [{ sessionId: 's1', title: 'Fix the drawer' }]
const noop = () => {}
const confirmed = () => Promise.resolve(true)
let cache = new WorkspaceListCache()
beforeEach(() => { cache = new WorkspaceListCache() })

/** `client: null` is the offline path: the seed is the whole list, no request. */
const sidebar = (overrides: Partial<WorkspaceSidebarProps> = {}) => (
  <WorkspaceSidebar
    client={null}
    cache={cache}
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

/** A host answering by command type, counting each. */
const host = () => {
  const request = jest.fn(async (command: { type: string }) => command.type === 'list_pinned_sessions'
    ? { sessions: [{ sessionId: 'p1', title: 'Pinned one', projectPath: '/repo', projectName: 'repo', isPinned: true }] }
    : { sessions: seed, totalCount: seed.length })
  const calls = (type: string) => request.mock.calls.filter(([command]) => command.type === type).length
  return { client: { request } as unknown as RelayClient, calls }
}
/** The drawer's close and reopen: the whole list unmounted and mounted again against one cache. */
const remountable = (mounted: boolean, overrides: Partial<WorkspaceSidebarProps>) => <>{mounted ? sidebar(overrides) : null}</>

test('a remount keeps the Pinned section without asking for it again', async () => {
  const { client, calls } = host()
  const { rerender } = await renderWithTheme(remountable(true, { client }))
  await waitFor(() => expect(screen.getByText('Pinned one')).toBeTruthy())
  expect(calls('list_pinned_sessions')).toBe(1)
  await rerender(remountable(false, { client }))

  await rerender(remountable(true, { client }))
  expect(screen.getByText('Pinned one')).toBeTruthy()
  await act(async () => {})
  expect(calls('list_pinned_sessions')).toBe(1)
  expect(calls('list_sessions')).toBe(1)
})

test('a change in any project re-reads the Pinned section, which spans them all', async () => {
  const { client, calls } = host()
  const { rerender } = await renderWithTheme(remountable(true, { client }))
  await waitFor(() => expect(calls('list_pinned_sessions')).toBe(1))

  cache.invalidate('/other')
  await rerender(remountable(true, { client, listRevision: 1 }))
  await waitFor(() => expect(calls('list_pinned_sessions')).toBe(2))
  // The open project was not named, so its list is left alone.
  expect(calls('list_sessions')).toBe(1)
})

test('a remount keeps the projects the user had expanded', async () => {
  const { rerender } = await renderWithTheme(remountable(true, {}))
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'other' })) })
  expect(screen.getByRole('button', { name: 'other', expanded: true })).toBeTruthy()
  await rerender(remountable(false, {}))

  await rerender(remountable(true, {}))
  expect(screen.getByRole('button', { name: 'other', expanded: true })).toBeTruthy()
})
