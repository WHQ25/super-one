/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { appState, chatState, mockEnvironment, notifyChat, sessionFixtures } from '../AppSidebar.test-setup'
import { useSidebarSessions } from './use-sidebar-sessions'

const FOLDER = '/project-a'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function setup() {
  const hostProjects = appState.recentFolders.map((folder) => ({
    ...folder, id: folder.path, lastOpened: folder.addedAt,
  }))
  return renderHook(() => useSidebarSessions({
    currentFolder: null, selectedHostConnectionId: 'local', hostProjects,
  }))
}

it('loads every non-settled page and restarts an invalidated load at offset zero', async () => {
  const rows = Array.from({ length: 150 }, (_, index) => ({
    sessionId: `root-${index}`, title: `Session ${index}`,
    lastActiveAt: '2026-03-02T00:00:00.000Z', messageCount: 1,
  }))
  sessionFixtures.byFolder[FOLDER] = rows
  const { result } = setup()
  await act(async () => { await result.current.loadFolderSessions(FOLDER, 'expand') })
  expect(result.current.folderSessions[FOLDER]).toHaveLength(150)
  expect(mockEnvironment.listSessions.mock.calls.map((call) => call[2]?.offset)).toEqual([0, 100])

  const stale = deferred<typeof rows>()
  mockEnvironment.listSessions.mockImplementationOnce(() => stale.promise)
  let refresh!: Promise<unknown>
  await act(async () => { refresh = result.current.loadFolderSessions(FOLDER, 'refresh') })
  await waitFor(() => expect(mockEnvironment.listSessions).toHaveBeenLastCalledWith('local', FOLDER, { limit: 100, offset: 0 }))
  const extra = { ...rows[0]!, sessionId: 'extra', title: 'Extra' }
  sessionFixtures.byFolder[FOLDER] = [extra, ...rows]
  await act(async () => {
    result.current.refreshFolderSessions(FOLDER)
    result.current.refreshFolderSessions(FOLDER)
  })
  await act(async () => { stale.resolve(rows.slice(0, 100)); await refresh })

  const loaded = result.current.folderSessions[FOLDER]!
  expect(loaded.map((row) => row.sessionId)).toEqual(sessionFixtures.byFolder[FOLDER]!.map((row) => row.sessionId))
  expect(new Set(loaded.map((row) => row.sessionId)).size).toBe(loaded.length)
  expect(mockEnvironment.listSessions.mock.calls.map((call) => call[2]?.offset)).toEqual([0, 100, 0, 0, 100])
})

it('pages settled sessions and appends the next page when asked', async () => {
  sessionFixtures.byFolder[FOLDER] = [
    { sessionId: 'live', title: 'Live', lastActiveAt: '2026-03-02T00:00:00.000Z', messageCount: 1 },
    ...Array.from({ length: 25 }, (_, index) => ({
      sessionId: `set-${index}`,
      title: `Settled ${index}`,
      lastActiveAt: '2026-03-01T00:00:00.000Z',
      messageCount: 1,
      isSettled: true,
    })),
  ]
  const { result } = setup()
  await act(async () => { await result.current.loadFolderSessions(FOLDER, 'expand') })
  await waitFor(() => expect(result.current.settledSessions).toHaveLength(20))
  expect(mockEnvironment.listSettledSessions).toHaveBeenCalledWith('local', {
    projectPath: FOLDER, limit: 20, offset: 0,
  })
  expect(result.current.settledCounts[FOLDER]).toBe(25)
  expect(result.current.settledHasMore[FOLDER]).toBe(true)

  await act(async () => { await result.current.loadMoreSettledSessions(FOLDER) })
  expect(result.current.settledSessions.map((row) => row.sessionId)).toEqual(
    Array.from({ length: 25 }, (_, index) => `set-${index}`),
  )
  expect(result.current.settledHasMore[FOLDER]).toBeUndefined()
  expect(result.current.settledCounts[FOLDER]).toBe(25)
  expect(mockEnvironment.listSettledSessions).toHaveBeenCalledWith('local', {
    projectPath: FOLDER, limit: 20, offset: 20,
  })
})

it('clears the in-flight request after a failed load so a later refresh can recover', async () => {
  const { result } = setup()
  mockEnvironment.listSessions.mockRejectedValueOnce(new Error('disconnected'))
  await act(async () => { await result.current.loadFolderSessions(FOLDER, 'expand') })
  await act(async () => { await result.current.loadFolderSessions(FOLDER, 'refresh') })
  expect(result.current.folderSessions[FOLDER]).toMatchObject(sessionFixtures.byFolder[FOLDER])
  expect(mockEnvironment.listSessions).toHaveBeenCalledTimes(2)
})

it('refreshes a phone-created voice session in another cached project without selecting it', async () => {
  let changed!: (projectPath?: string) => void
  vi.mocked(window.app.onSessionChanged).mockImplementation(callback => { changed = callback; return () => {} })
  const { result } = setup()
  await act(async () => { await result.current.loadFolderSessions(FOLDER, 'expand') })
  const voice = { sessionId: 'phone-voice', title: 'Voice conversation', provider: 'codex', lastActiveAt: '2026-10-10T00:00:00.000Z', messageCount: 0 }
  sessionFixtures.byFolder[FOLDER] = [voice, ...sessionFixtures.byFolder[FOLDER]]
  mockEnvironment.listSessions.mockClear()
  await act(async () => { changed(FOLDER) })
  await waitFor(() => expect(result.current.folderSessions[FOLDER][0]).toMatchObject(voice))
  expect(mockEnvironment.listSessions).toHaveBeenCalledWith('local', FOLDER, { limit: 100, offset: 0 })
})

it("re-reads only the paired machine's project its list notice names", async () => {
  const REMOTE = 'remote:conn-b:/work/app'
  let changed!: (projectPath?: string) => void
  vi.mocked(window.app.onSessionChanged).mockImplementation(callback => { changed = callback; return () => {} })
  sessionFixtures.byFolder.p1 = [{ sessionId: 'b-own', title: 'New session', lastActiveAt: '2026-10-10T00:00:00.000Z', messageCount: 0 }]
  const { result } = renderHook(() => useSidebarSessions({
    currentFolder: null, selectedHostConnectionId: 'conn-b',
    hostProjects: [{ id: 'p1', path: REMOTE, name: 'app', addedAt: '2026-10-10T00:00:00.000Z', lastOpened: '2026-10-10T00:00:00.000Z' }],
  }))
  await act(async () => { await result.current.loadFolderSessions(FOLDER, 'expand') })
  await act(async () => { await result.current.loadFolderSessions(REMOTE, 'expand') })
  mockEnvironment.listSessions.mockClear()

  // B's window renames its session; B's `sessionList` notice names the project.
  sessionFixtures.byFolder.p1 = [{ ...sessionFixtures.byFolder.p1[0], title: 'Renamed on B' }]
  await act(async () => { changed(REMOTE) })
  await waitFor(() => expect(result.current.folderSessions[REMOTE][0]).toMatchObject({ sessionId: 'b-own', title: 'Renamed on B' }))
  expect(mockEnvironment.listSessions.mock.calls).toEqual([['conn-b', 'p1', { limit: 100, offset: 0 }]])
})

it('keeps a cached folder quiet while a refresh is in flight', async () => {
  const { result } = setup()
  await act(async () => { await result.current.loadFolderSessions(FOLDER, 'expand') })
  const pending = deferred<typeof sessionFixtures.byFolder[typeof FOLDER]>()
  mockEnvironment.listSessions.mockImplementationOnce(() => pending.promise)
  let refresh!: Promise<unknown>
  await act(async () => { refresh = result.current.loadFolderSessions(FOLDER, 'refresh') })
  expect(result.current.loadingFolders[FOLDER]).toBeUndefined()
  await act(async () => { pending.resolve(sessionFixtures.byFolder[FOLDER]); await refresh })
  expect(result.current.loadingFolders[FOLDER]).toBeUndefined()
})

it('does not spin a local folder while its session list loads', async () => {
  const pending = deferred<typeof sessionFixtures.byFolder[typeof FOLDER]>()
  mockEnvironment.listSessions.mockImplementationOnce(() => pending.promise)
  const { result } = setup()
  let load!: Promise<unknown>
  await act(async () => { load = result.current.loadFolderSessions(FOLDER, 'expand') })
  expect(result.current.loadingFolders[FOLDER]).toBeUndefined()

  await act(async () => { pending.resolve(sessionFixtures.byFolder[FOLDER]); await load })
  expect(result.current.loadingFolders[FOLDER]).toBeUndefined()
})

it('reloads when the open session starts streaming and stays quiet when that turn ends', async () => {
  const hostProjects = appState.recentFolders.map((folder) => ({
    ...folder, id: folder.path, lastOpened: folder.addedAt,
  }))
  const { result } = renderHook(() => useSidebarSessions({
    currentFolder: FOLDER, selectedHostConnectionId: 'local', hostProjects,
  }))
  await waitFor(() => expect(result.current.folderSessions[FOLDER]).toHaveLength(1))
  mockEnvironment.listSessions.mockClear()

  const project = chatState.projectSessions[FOLDER] as {
    _activeSessionId: string
    _sessions: Record<string, { status: string }>
  }
  act(() => {
    project._sessions['sid-1'].status = 'streaming'
    notifyChat()
  })
  await waitFor(() => expect(mockEnvironment.listSessions).toHaveBeenCalled())
  await act(async () => { await Promise.resolve() })
  mockEnvironment.listSessions.mockClear()

  act(() => {
    project._sessions['sid-1'].status = 'idle'
    notifyChat()
  })
  await act(async () => { await Promise.resolve() })
  expect(mockEnvironment.listSessions).not.toHaveBeenCalled()

  act(() => {
    project._sessions['sid-2'] = { ...project._sessions['sid-1'], status: 'idle' }
    project._activeSessionId = 'sid-2'
    notifyChat()
  })
  await waitFor(() => expect(mockEnvironment.listSessions).toHaveBeenCalled())
})

it('marks a remote folder loading until its session list returns', async () => {
  const REMOTE = 'remote:conn-b:/work/app'
  const pending = deferred<typeof sessionFixtures.byFolder[typeof FOLDER]>()
  mockEnvironment.listSessions.mockImplementationOnce(() => pending.promise)
  const { result } = renderHook(() => useSidebarSessions({
    currentFolder: null, selectedHostConnectionId: 'conn-b',
    hostProjects: [{ id: 'p1', path: REMOTE, name: 'app', addedAt: '2026-10-10T00:00:00.000Z', lastOpened: '2026-10-10T00:00:00.000Z' }],
  }))
  let load!: Promise<unknown>
  await act(async () => { load = result.current.loadFolderSessions(REMOTE, 'expand') })
  expect(result.current.loadingFolders[REMOTE]).toBe(true)

  await act(async () => { pending.resolve(sessionFixtures.byFolder[FOLDER]); await load })
  expect(result.current.loadingFolders[REMOTE]).toBeUndefined()
})
