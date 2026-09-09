import { expect, test, jest } from '@jest/globals'
import { act } from '@testing-library/react-native'
import type { RelayClient } from '@superone/relay-client'
import type { SessionActivity } from '@superone/shared/session-activity'
import { renderWithTheme } from '../test-render'
import { useWorkspaceActivity } from './use-session-activity'

const row: SessionActivity = { sessionId: 'background', projectPath: '/other', status: 'idle', provider: 'codex', pendingCount: 2, pendingReason: { en: 'Allow Bash?', zh: '允许 Bash？' } }
let current: ReturnType<typeof useWorkspaceActivity>
function Probe({ client, connected = true, viewed = null }: { client: RelayClient; connected?: boolean; viewed?: string | null }) {
  current = useWorkspaceActivity(client, connected, 0, viewed)
  return null
}

test('restores unopened sessions and does not overwrite newer pushes with a slow snapshot', async () => {
  let resolve!: (result: unknown) => void
  const client = { request: jest.fn(() => new Promise(done => { resolve = done })) } as unknown as RelayClient
  await renderWithTheme(<Probe client={client} />)
  await act(async () => current.ingest([{ type: 'session_activity', activity: { ...row, pendingCount: 0 } }]))
  await act(async () => resolve({ sessions: [row] }))
  expect(current.pendingCount).toBe(0)
  await act(async () => current.ingest([{ type: 'session_activity', activity: row }, { type: 'session_activity', activity: row }]))
  expect(current.pendingCount).toBe(2)
})

test('replaces stale attention on reconnect and clears it when switching hosts', async () => {
  const request = jest.fn<() => Promise<unknown>>().mockResolvedValueOnce({ sessions: [row] }).mockResolvedValue({ sessions: [] })
  const client = { request } as unknown as RelayClient
  const result = await renderWithTheme(<Probe client={client} />)
  await act(async () => {})
  expect(current.pendingCount).toBe(2)
  await result.rerender(<Probe client={client} connected={false} />)
  await result.rerender(<Probe client={client} />)
  await act(async () => {})
  expect(current.pendingCount).toBe(0)
  await act(async () => current.ingest([{ type: 'session_activity', activity: row }]))
  const other = { request: jest.fn(() => Promise.resolve({ sessions: [] })) } as unknown as RelayClient
  await result.rerender(<Probe client={other} />)
  expect(current.pendingCount).toBe(0)
})


test('keeps unseen completion through later pushes and clears it when the session opens', async () => {
  const client = { request: jest.fn(() => Promise.resolve({ sessions: [] })) } as unknown as RelayClient
  const result = await renderWithTheme(<Probe client={client} />)
  await act(async () => current.ingest([
    { type: 'session_activity', activity: { ...row, status: 'streaming' } },
    { type: 'session_activity', activity: row, completed: true },
    { type: 'session_activity', activity: row },
  ]))
  expect(current.sessions.background.isUnseen).toBe(true)
  await result.rerender(<Probe client={client} connected={false} />)
  await result.rerender(<Probe client={client} />)
  await act(async () => {})
  expect(current.sessions.background.isUnseen).toBe(true)
  await result.rerender(<Probe client={client} viewed="background" />)
  expect(current.sessions.background.isUnseen).toBe(false)
})
