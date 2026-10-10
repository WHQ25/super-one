import { expect, test, jest } from '@jest/globals'
import { act, screen } from '@testing-library/react-native'
import type { RelayClient } from '@superone/relay-client'
import type { SessionActivity } from '@superone/shared/session-activity'
import { renderWithTheme } from '../test-render'
import { SessionActivityContext, useWorkspaceActivity } from './use-session-activity'
import { WorkspaceButton } from '../ui/workspace-button'
import { SessionRowContent } from '../ui/session-row-content'

const row: SessionActivity = { sessionId: 'background', projectPath: '/other', status: 'idle', provider: 'codex', pendingCount: 2, pendingReason: { en: 'Allow Bash?', zh: '允许 Bash？' } }
let current: ReturnType<typeof useWorkspaceActivity>
function activityClient(snapshot: () => Promise<unknown>, seen = jest.fn()) {
  return { rpc: async (method: string, payload: unknown) => method === 'client.markSeen' ? seen(method, payload) : snapshot() } as unknown as RelayClient
}
function Probe({ client, connected = true, viewed = null }: { client: RelayClient; connected?: boolean; viewed?: string | null }) {
  current = useWorkspaceActivity(client, connected, viewed)
  return <SessionActivityContext.Provider value={current.sessions}>
    <WorkspaceButton pendingCount={current.pendingCount} onPress={() => {}} />
    <SessionRowContent item={{ session: { sessionId: row.sessionId, title: 'Background session' }, child: false, hasChildren: false, collapsed: false }} />
  </SessionActivityContext.Provider>
}

test('restores unopened sessions and does not overwrite newer pushes with a slow snapshot', async () => {
  let resolve!: (result: unknown) => void
  const client = activityClient(jest.fn(() => new Promise(done => { resolve = done })))
  await renderWithTheme(<Probe client={client} />)
  await act(async () => current.ingest([{ type: 'session_activity', activity: { ...row, pendingCount: 0, pendingReason: { en: null, zh: null } } }]))
  await act(async () => resolve({ sessions: [row] }))
  expect(current.pendingCount).toBe(0)
  expect(screen.queryByTestId('workspace-pending-badge')).toBeNull()
  expect(screen.queryByText('Allow Bash?')).toBeNull()
  await act(async () => current.ingest([{ type: 'session_activity', activity: row }, { type: 'session_activity', activity: row }]))
  expect(current.pendingCount).toBe(1)
  expect(screen.getByText('Allow Bash?')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Open Workspace, Sessions Need Attention' })).toBeTruthy()
})

test('native snapshots clear stale host status, preserve unread completions, and supersede pending reads', async () => {
  let resolve!: (result: unknown) => void
  const client = activityClient(() => new Promise(done => { resolve = done }))
  await renderWithTheme(<Probe client={client} />)
  await act(async () => current.ingestSnapshot([row], client))
  expect(current.pendingCount).toBe(1)
  await act(async () => current.ingestSnapshot([], client))
  await act(async () => resolve({ sessions: [row] }))
  expect(current.pendingCount).toBe(0)
  const done = { ...row, pendingCount: 0, completedMessageId: 'new-completion', seenCompletedMessageId: null }
  await act(async () => current.ingestSnapshot([done], client))
  expect(current.sessions.background.isUnseen).toBe(true)
  await act(async () => current.ingestSnapshot([], client))
  expect(current.sessions.background).toMatchObject({ isUnseen: true, pendingCount: 0, status: 'idle' })
})

test('retains a new host snapshot received before the host prop commits and discards the old host read', async () => {
  let resolve!: (result: unknown) => void
  const old = activityClient(() => new Promise(done => { resolve = done }))
  const result = await renderWithTheme(<Probe client={old} />)
  const next = activityClient(async () => ({ sessions: [] }))
  const nextRow = { ...row, sessionId: 'new-host' }
  await act(async () => current.ingestSnapshot([nextRow], next))
  await act(async () => resolve({ sessions: [row] }))
  await result.rerender(<Probe client={next} connected={false} />)
  expect(Object.keys(current.sessions)).toEqual(['new-host'])
  expect(current.pendingCount).toBe(1)
})

test('replaces stale attention on reconnect and clears it when switching hosts', async () => {
  const request = jest.fn<() => Promise<unknown>>().mockResolvedValueOnce({ sessions: [row] }).mockResolvedValue({ sessions: [] })
  const client = activityClient(request)
  const result = await renderWithTheme(<Probe client={client} />)
  await act(async () => {})
  expect(current.pendingCount).toBe(1)
  await result.rerender(<Probe client={client} connected={false} />)
  await result.rerender(<Probe client={client} />)
  await act(async () => {})
  expect(current.pendingCount).toBe(0)
  await act(async () => current.ingest([{ type: 'session_activity', activity: row }]))
  const other = activityClient(jest.fn(() => Promise.resolve({ sessions: [] })))
  await result.rerender(<Probe client={other} />)
  expect(current.pendingCount).toBe(0)
})


test('keeps unseen completion through later pushes and clears it when the session opens', async () => {
  const client = activityClient(jest.fn(() => Promise.resolve({ sessions: [] })))
  const result = await renderWithTheme(<Probe client={client} />)
  await act(async () => current.ingest([
    { type: 'session_activity', activity: { ...row, status: 'streaming' } },
    { type: 'session_activity', activity: row, completed: true },
    { type: 'session_activity', activity: row },
  ]))
  expect(current.sessions.background.isUnseen).toBe(true)
  expect(current.pendingCount).toBe(1)
  await result.rerender(<Probe client={client} connected={false} />)
  await result.rerender(<Probe client={client} />)
  await act(async () => {})
  expect(current.sessions.background.isUnseen).toBe(true)
  expect(current.pendingCount).toBe(1)
  await result.rerender(<Probe client={client} viewed="background" />)
  expect(current.sessions.background.isUnseen).toBe(false)
  expect(current.pendingCount).toBe(0)
})

test('reports a read to the host when the session opens or finishes on screen, and takes the host receipt for reads elsewhere', async () => {
  const send = jest.fn()
  const client = activityClient(jest.fn(() => Promise.resolve({ sessions: [] })), send)
  const result = await renderWithTheme(<Probe client={client} />)
  const done = { ...row, pendingCount: 0, completedMessageId: 'reply-1' }
  await act(async () => current.ingest([
    { type: 'session_activity', activity: { ...done, status: 'streaming' } },
    { type: 'session_activity', activity: done, completed: true },
  ]))
  expect(current.sessions.background.isUnseen).toBe(true)
  expect(send).not.toHaveBeenCalled()

  // Read on desktop: the host receipt matches the completion, the dot goes without a round trip.
  await act(async () => current.ingest([{ type: 'session_activity', activity: { ...done, seenCompletedMessageId: 'reply-1' } }]))
  expect(current.sessions.background.isUnseen).toBe(false)
  expect(send).not.toHaveBeenCalled()

  // A newer reply the desktop has not seen: unread again, and opening it here reports the read.
  await act(async () => current.ingest([{ type: 'session_activity', activity: { ...done, completedMessageId: 'reply-2', seenCompletedMessageId: 'reply-1' }, completed: true }]))
  expect(current.sessions.background.isUnseen).toBe(true)
  await result.rerender(<Probe client={client} viewed="background" />)
  expect(current.sessions.background.isUnseen).toBe(false)
  expect(send).toHaveBeenCalledWith('client.markSeen', { sessionId: 'background' })

  // A run finishing while on screen is read as it lands.
  send.mockClear()
  await act(async () => current.ingest([{ type: 'session_activity', activity: { ...done, completedMessageId: 'reply-3', seenCompletedMessageId: 'reply-2' }, completed: true }]))
  expect(current.sessions.background.isUnseen).toBe(false)
  expect(send).toHaveBeenCalledTimes(1)
})

test('re-reports the on-screen session from the reconnect snapshot and survives a dead socket', async () => {
  const done = { ...row, pendingCount: 0, completedMessageId: 'reply-1' }
  const send = jest.fn(() => { throw new Error('not connected') })
  const request = jest.fn<() => Promise<unknown>>().mockResolvedValue({ sessions: [done] })
  const client = activityClient(request, send)
  const result = await renderWithTheme(<Probe client={client} viewed="background" />)
  await act(async () => {})
  // Read on screen; the host has no receipt yet, so the snapshot triggers one.
  expect(send).toHaveBeenCalledWith('client.markSeen', { sessionId: 'background' })
  expect(current.sessions.background.isUnseen).toBe(false)

  // Host already holds the receipt: nothing to report on the next reconnect.
  send.mockClear()
  request.mockResolvedValue({ sessions: [{ ...done, seenCompletedMessageId: 'reply-1' }] })
  await result.rerender(<Probe client={client} connected={false} viewed="background" />)
  await result.rerender(<Probe client={client} viewed="background" />)
  await act(async () => {})
  expect(send).not.toHaveBeenCalled()
})

test('counts sessions needing attention once across multiple requests and unread completions', async () => {
  const client = activityClient(jest.fn(() => Promise.resolve({ sessions: [] })))
  const result = await renderWithTheme(<Probe client={client} />)
  await act(async () => current.ingest([
    { type: 'session_activity', activity: row },
    { type: 'session_activity', activity: row, completed: true },
    { type: 'session_activity', activity: { ...row, sessionId: 'done', pendingCount: 0 }, completed: true },
    { type: 'session_activity', activity: { ...row, sessionId: 'idle', pendingCount: 0 } },
  ]))
  expect(current.pendingCount).toBe(2)
  await result.rerender(<Probe client={client} viewed="done" />)
  expect(current.pendingCount).toBe(1)
  await act(async () => current.ingest([{ type: 'session_activity', activity: { ...row, pendingCount: 0 } }]))
  expect(current.pendingCount).toBe(0)
})
