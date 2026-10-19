/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { appState, mockEnvironment, sessionFixtures } from '../AppSidebar.test-setup'
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

it('restarts an invalidated show-more load at offset zero without duplicating or skipping rows', async () => {
  const rows = Array.from({ length: 60 }, (_, index) => ({
    sessionId: `root-${index}`, title: `Session ${index}`,
    lastActiveAt: '2026-03-02T00:00:00.000Z', messageCount: 1,
  }))
  sessionFixtures.byFolder[FOLDER] = rows
  const { result } = setup()
  await act(async () => { await result.current.loadFolderSessions(FOLDER, 'expand') })
  expect(result.current.folderSessions[FOLDER]).toHaveLength(26)

  const stale = deferred<typeof rows>()
  mockEnvironment.listSessions.mockImplementationOnce(() => stale.promise)
  let more!: Promise<typeof rows>
  await act(async () => { more = result.current.loadMoreFolderSessions(FOLDER, 40) })
  await waitFor(() => expect(mockEnvironment.listSessions).toHaveBeenLastCalledWith('local', FOLDER, { limit: 13, offset: 26 }))
  const child = { ...rows[0], sessionId: 'child', title: 'Child', parentSessionId: rows[0].sessionId }
  sessionFixtures.byFolder[FOLDER] = [rows[0], child, ...rows.slice(1)]
  await act(async () => { result.current.refreshFolderSessions(FOLDER); result.current.refreshFolderSessions(FOLDER) })
  await act(async () => { stale.resolve(rows.slice(26, 39)); await more })

  const loaded = result.current.folderSessions[FOLDER]
  expect(loaded).toMatchObject(sessionFixtures.byFolder[FOLDER].slice(0, 52))
  expect(new Set(loaded.map((row) => row.sessionId)).size).toBe(loaded.length)
  expect(mockEnvironment.listSessions.mock.calls.map(([, , options]) => options?.offset)).toEqual([0, 13, 26, 0, 13, 26, 39])
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
  expect(mockEnvironment.listSessions).toHaveBeenCalledWith('local', FOLDER, { limit: 13, offset: 0 })
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
  expect(mockEnvironment.listSessions.mock.calls).toEqual([['conn-b', 'p1', { limit: 13, offset: 0 }]])
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

it('marks a folder loading until its session list returns', async () => {
  const pending = deferred<typeof sessionFixtures.byFolder[typeof FOLDER]>()
  mockEnvironment.listSessions.mockImplementationOnce(() => pending.promise)
  const { result } = setup()
  let load!: Promise<unknown>
  await act(async () => { load = result.current.loadFolderSessions(FOLDER, 'expand') })
  expect(result.current.loadingFolders[FOLDER]).toBe(true)

  await act(async () => { pending.resolve(sessionFixtures.byFolder[FOLDER]); await load })
  expect(result.current.loadingFolders[FOLDER]).toBeUndefined()
})
