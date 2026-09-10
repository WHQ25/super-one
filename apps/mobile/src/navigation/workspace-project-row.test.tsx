import { expect, jest, test } from '@jest/globals'
import { screen, waitFor } from '@testing-library/react-native'
import type { RelayClient } from '@superone/relay-client'
import type { SessionActivity } from '@superone/shared/session-activity'
import { renderWithTheme } from '../test-render'
import { SessionActivityContext } from './use-session-activity'
import { WorkspaceProjectRow, type WorkspaceProjectRowProps } from './workspace-project-row'
import type { SessionListRow } from '../session-list-state'

const seed: SessionListRow[] = [{ sessionId: 's1', title: 'Fix the drawer' }]
const noop = () => {}
const confirmed = () => Promise.resolve(true)

/** `client: null` is the offline path: the seed is the whole list, no request. */
const row = (overrides: Partial<WorkspaceProjectRowProps> = {}) => (
  <WorkspaceProjectRow
    client={null}
    project={{ path: '/repo', name: 'repo' }}
    expanded={false}
    onToggle={noop}
    seed={seed}
    activeSessionId={null}
    visible
    listRevision={0}
    onOpenSession={noop}
    onPinSession={confirmed}
    onArchiveSession={confirmed}
    onDeleteSession={confirmed}
    {...overrides}
  />
)

test('does not mount a list for a project that has never been expanded', async () => {
  await renderWithTheme(row())
  expect(screen.getByText('repo')).toBeTruthy()
  expect(screen.queryByText('Fix the drawer')).toBeNull()
})

test('uses the same title and icon size as a session row', async () => {
  await renderWithTheme(row({ expanded: true }))
  expect(screen.getByText('repo')).toHaveStyle({ fontSize: 15 })
  expect(screen.getByText('Fix the drawer')).toHaveStyle({ fontSize: 15 })
  expect(screen.getByTestId('project-list-icon')).toHaveStyle({ width: 18, height: 18 })
  expect(screen.getByTestId('session-list-icon')).toHaveStyle({ width: 18, height: 18 })
})

test('shows a pending session under a collapsed project', async () => {
  const pending: SessionActivity = {
    sessionId: 'ask', projectPath: '/repo', status: 'idle', provider: 'codex',
    pendingCount: 1, pendingReason: { en: 'Allow Bash?', zh: '允许 Bash？' }, title: 'Needs input',
  }
  await renderWithTheme(
    <SessionActivityContext.Provider value={{ ask: pending }}>
      {row({ seed: [] })}
    </SessionActivityContext.Provider>,
  )
  expect(screen.getByText('Needs input')).toBeTruthy()
  expect(screen.getByText('Allow Bash?')).toBeTruthy()
})

test('shows the sessions once expanded', async () => {
  await renderWithTheme(row({ expanded: true }))
  expect(screen.getByText('Fix the drawer')).toBeTruthy()
})

test('keeps the loaded list mounted across a collapse, so re-expanding costs no request', async () => {
  const { rerender } = await renderWithTheme(row({ expanded: true }))
  expect(screen.getByText('Fix the drawer')).toBeTruthy()

  await rerender(row({ expanded: false }))
  // Ordinary rows leave the tree while collapsed — desktop only keeps
  // attention visible then. The hook holding the loaded rows stays mounted,
  // so expanding again does not refetch.
  expect(screen.queryByText('Fix the drawer')).toBeNull()

  await rerender(row({ expanded: true }))
  expect(screen.getByText('Fix the drawer')).toBeTruthy()
})

test('keeps the seed and does not paint a dropped-transport error in the list', async () => {
  const request = jest.fn(() => Promise.reject(new Error('not connected')))
  await renderWithTheme(row({ expanded: true, client: { request } as unknown as RelayClient }))
  await waitFor(() => expect(request).toHaveBeenCalled())
  expect(screen.getByText('Fix the drawer')).toBeTruthy()
  expect(screen.queryByText(/not connected/i)).toBeNull()
})

test('still reports a host failure that is not a dropped transport', async () => {
  const request = jest.fn(() => Promise.reject(new Error('no such project')))
  await renderWithTheme(row({ expanded: true, client: { request } as unknown as RelayClient, seed: [] }))
  await waitFor(() => expect(screen.getByText('no such project')).toBeTruthy())
})
