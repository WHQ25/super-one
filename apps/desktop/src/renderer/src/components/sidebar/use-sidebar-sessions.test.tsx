/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
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
