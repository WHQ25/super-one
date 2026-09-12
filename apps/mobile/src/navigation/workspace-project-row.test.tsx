import { expect, jest, test } from '@jest/globals'
import { useState } from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native'
import type { RelayClient } from '@superone/relay-client'
import type { SessionActivity } from '@superone/shared/session-activity'
import { renderWithTheme } from '../test-render'
import { SessionActivityContext } from './use-session-activity'
import { WorkspaceProjectRow, type WorkspaceProjectRowProps } from './workspace-project-row'
import type { SessionListRow } from '../session-list-state'

jest.mock('../ui/use-icon-motion', () => ({ useIconMotion: () => true }))

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

test('shows a running session under a collapsed project', async () => {
  const running: SessionActivity = {
    sessionId: 'run', projectPath: '/repo', status: 'streaming', provider: 'claude',
    pendingCount: 0, pendingReason: { en: null, zh: null }, title: 'Long running task',
  }
  await renderWithTheme(
    <SessionActivityContext.Provider value={{ run: running }}>
      {row({ seed: [{ sessionId: 'idle', title: 'Idle session' }, { sessionId: 'run', title: 'Long running task' }] })}
    </SessionActivityContext.Provider>,
  )
  expect(screen.getByText('Long running task')).toBeTruthy()
  expect(screen.queryByText('Idle session')).toBeNull()
})

test('shows an unseen session under a collapsed project', async () => {
  await renderWithTheme(
    <SessionActivityContext.Provider value={{
      unread: {
        sessionId: 'unread', projectPath: '/repo', status: 'idle', provider: 'codex',
        pendingCount: 0, pendingReason: { en: null, zh: null }, title: 'Unseen completed session',
        isUnseen: true,
      },
    }}>
      {row({ seed: [{ sessionId: 'idle', title: 'Idle session' }, { sessionId: 'unread', title: 'Unseen completed session' }] })}
    </SessionActivityContext.Provider>,
  )
  expect(screen.getByText('Unseen completed session')).toBeTruthy()
  expect(screen.queryByText('Idle session')).toBeNull()
})

test('shows the sessions once expanded', async () => {
  await renderWithTheme(row({ expanded: true }))
  expect(screen.getByText('Fix the drawer')).toBeTruthy()
})

test('reports expanded state on the project row', async () => {
  const { rerender } = await renderWithTheme(row())
  expect(screen.getByRole('button', { name: 'repo', expanded: false })).toBeTruthy()
  await rerender(row({ expanded: true }))
  expect(screen.getByRole('button', { name: 'repo', expanded: true })).toBeTruthy()
})

test('keeps the loaded list mounted across a collapse, so re-expanding costs no request', async () => {
  const { rerender } = await renderWithTheme(row({ expanded: true }))
  expect(screen.getByText('Fix the drawer')).toBeTruthy()

  await rerender(row({ expanded: false }))
  // Ordinary rows leave the tree while collapsed — desktop only keeps live,
  // unseen, pending and the active session visible then. The hook holding
  // the loaded rows stays mounted, so expanding again does not refetch.
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

test('shows the first read beside the project name, not inside the list', async () => {
  // The spinner used to sit above the seeded rows and push them down for the
  // duration of the read; on the header it changes nothing below it.
  const request = jest.fn(() => new Promise(() => {}))
  await renderWithTheme(row({ expanded: true, client: { request } as unknown as RelayClient }))
  expect(screen.getByRole('button', { name: 'repo', expanded: true, busy: true })).toBeTruthy()
  // The spinner takes the folder glyph's slot, so nothing else on the row moves.
  expect(screen.getByTestId('project-list-loading')).toHaveStyle({ width: 18, height: 18 })
  expect(screen.queryByTestId('project-list-icon')).toBeNull()
  expect(screen.getByText('Fix the drawer')).toBeTruthy()
})

test('does not spin on a collapsed project', async () => {
  const request = jest.fn(() => new Promise(() => {}))
  // Pending work arms the list without expanding it; the read still runs but
  // the header stays quiet because there is no open list waiting on it.
  await renderWithTheme(
    <SessionActivityContext.Provider value={{
      ask: {
        sessionId: 'ask', projectPath: '/repo', status: 'idle', provider: 'codex',
        pendingCount: 1, pendingReason: { en: 'Allow Bash?', zh: '允许 Bash？' }, title: 'Needs input',
      },
    }}>
      {row({ client: { request } as unknown as RelayClient })}
    </SessionActivityContext.Provider>,
  )
  await waitFor(() => expect(request).toHaveBeenCalled())
  expect(screen.queryByTestId('project-list-loading')).toBeNull()
})

/** Reanimated is mocked to plain views, so the unfold shows up as `entering` on a row wrapper. */
const unfoldPlayed = () => JSON.stringify(screen.toJSON()).includes('"entering"')

test('lands an expansion nobody tapped already open, without the unfold', async () => {
  // The drawer opens the active project itself on every mount; rows sliding in
  // each time read as the list being re-fetched.
  await renderWithTheme(row({ expanded: true }))
  expect(screen.getByText('Fix the drawer')).toBeTruthy()
  expect(unfoldPlayed()).toBe(false)
})

test('plays the unfold when the project row itself is tapped', async () => {
  function Toggling() {
    const [expanded, setExpanded] = useState(false)
    return row({ expanded, onToggle: () => setExpanded((open) => !open) })
  }
  await renderWithTheme(<Toggling />)
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'repo' })) })
  expect(screen.getByText('Fix the drawer')).toBeTruthy()
  expect(unfoldPlayed()).toBe(true)
})
