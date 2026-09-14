import { beforeEach, expect, jest, test } from '@jest/globals'
import { useState } from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native'
import type { RelayClient } from '@superone/relay-client'
import type { SessionActivity } from '@superone/shared/session-activity'
import { renderWithTheme } from '../test-render'
import { SessionActivityContext } from './use-session-activity'
import { WorkspaceProjectRow, type WorkspaceProjectRowProps } from './workspace-project-row'
import type { SessionListRow } from '../session-list-state'
import { WorkspaceListCache } from '../workspace-list-cache'

jest.mock('../ui/use-icon-motion', () => ({ useIconMotion: () => true }))

const seed: SessionListRow[] = [{ sessionId: 's1', title: 'Fix the drawer' }]
const noop = () => {}
const confirmed = () => Promise.resolve(true)
// One per test, as the shell keeps one per connection; a rerender must not
// hand the row a different cache, which would read as a new connection.
let cache = new WorkspaceListCache()
beforeEach(() => { cache = new WorkspaceListCache() })

/** `client: null` is the offline path: the seed is the whole list, no request. */
const row = (overrides: Partial<WorkspaceProjectRowProps> = {}) => (
  <WorkspaceProjectRow
    client={null}
    cache={cache}
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

/** A host that answers `list_sessions` at once, and counts how often it was asked. */
const answering = (rows: SessionListRow[]) => {
  const request = jest.fn(async () => ({ sessions: rows, totalCount: rows.length }))
  return { client: { request } as unknown as RelayClient, request }
}

test('updates the scheduled icon from a host list invalidation without reopening the drawer', async () => {
  const scheduled = { sessionId: 'h1', title: 'Scheduled review', scheduledSendAt: Date.UTC(2026, 8, 15, 10) }
  const { client, request } = answering([scheduled])
  const { rerender } = await renderWithTheme(row({ expanded: true, client, seed: [] }))
  await waitFor(() => expect(screen.getByTestId('session-scheduled-send')).toBeTruthy())

  request.mockResolvedValue({ sessions: [{ ...scheduled, scheduledSendAt: null }], totalCount: 1 })
  cache.invalidate('/repo')
  await rerender(row({ expanded: true, client, seed: [], listRevision: 1 }))
  await waitFor(() => expect(screen.queryByTestId('session-scheduled-send')).toBeNull())
  expect(screen.getByText('Scheduled review')).toBeTruthy()
})
/**
 * The drawer's close and reopen, as the row sees it: unmounted, then mounted
 * again against the same cache. Driven by a prop through `rerender` — a bare
 * `unmount()` followed by a second `render` in one test leaves the next test's
 * tree uncommitted (the same act-scope overlap `fireEvent` has).
 */
const remountable = (mounted: boolean, overrides: Partial<WorkspaceProjectRowProps>) => <>{mounted ? row(overrides) : null}</>

test('a remount paints the cached list without a request or a spinner', async () => {
  // The drawer unmounts its rows on every close. Before the cache, every open
  // was a first mount: spinner on the folder and one list_sessions per row.
  const { client, request } = answering([{ sessionId: 'h1', title: 'From the host' }])
  const { rerender } = await renderWithTheme(remountable(true, { expanded: true, client, seed: [] }))
  await waitFor(() => expect(screen.getByText('From the host')).toBeTruthy())
  expect(request).toHaveBeenCalledTimes(1)
  await rerender(remountable(false, { expanded: true, client, seed: [] }))
  expect(screen.queryByText('From the host')).toBeNull()

  await rerender(remountable(true, { expanded: true, client, seed: [] }))
  expect(screen.getByText('From the host')).toBeTruthy()
  expect(screen.queryByTestId('project-list-loading')).toBeNull()
  await act(async () => {})
  expect(request).toHaveBeenCalledTimes(1)
})

test('a remount after the host invalidated this project re-reads in place', async () => {
  const { client, request } = answering([{ sessionId: 'h1', title: 'From the host' }])
  const { rerender } = await renderWithTheme(remountable(true, { expanded: true, client, seed: [] }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  await rerender(remountable(false, { expanded: true, client, seed: [] }))

  cache.invalidate('/repo')
  await rerender(remountable(true, { expanded: true, client, seed: [], listRevision: 1 }))
  // The stale rows stay up while the re-read is out — no wipe, no spinner.
  expect(screen.getByText('From the host')).toBeTruthy()
  expect(screen.queryByTestId('project-list-loading')).toBeNull()
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
})

test('a change in another project costs this one nothing', async () => {
  const { client, request } = answering([{ sessionId: 'h1', title: 'From the host' }])
  const { rerender } = await renderWithTheme(row({ expanded: true, client, seed: [] }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))

  cache.invalidate('/elsewhere')
  await rerender(row({ expanded: true, client, seed: [], listRevision: 1 }))
  await act(async () => {})
  expect(request).toHaveBeenCalledTimes(1)
})

test('a reconnect stales every list, so the next open re-reads it', async () => {
  const { client, request } = answering([{ sessionId: 'h1', title: 'From the host' }])
  const { rerender } = await renderWithTheme(row({ expanded: true, client, seed: [] }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))

  cache.invalidateAll()
  await rerender(row({ expanded: true, client, seed: [], listRevision: 1 }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
})

test('a collapsed list does not chase an invalidation until it is opened', async () => {
  const { client, request } = answering([{ sessionId: 'h1', title: 'From the host' }])
  const { rerender } = await renderWithTheme(row({ expanded: true, client, seed: [] }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))

  await rerender(row({ expanded: false, client, seed: [] }))
  cache.invalidate('/repo')
  await rerender(row({ expanded: false, client, seed: [], listRevision: 1 }))
  await act(async () => {})
  expect(request).toHaveBeenCalledTimes(1)

  await rerender(row({ expanded: true, client, seed: [], listRevision: 1 }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
})

test('a seed left standing by a failed read is not remembered as a read', async () => {
  const request = jest.fn(() => Promise.reject(new Error('not connected')))
  const client = { request } as unknown as RelayClient
  const { rerender } = await renderWithTheme(remountable(true, { expanded: true, client }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  await rerender(remountable(false, { expanded: true, client }))

  // Nothing cached: the next mount asks again rather than trusting the seed.
  await rerender(remountable(true, { expanded: true, client }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
})
