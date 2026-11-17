/** @vitest-environment jsdom */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runDatabaseMigrations } from '../../main/database-migrations'
import { listFailedRemoteSends, listPendingDrafts, resolveFailedRemoteSend, saveFailedRemoteSend } from '../../main/db-drafts'
import { mapRemoteSessionRow } from '../../main/environment/remote-session-row'
import { startFailedRemoteSendRecovery } from '@/lib/failed-remote-sends'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useDraftsStore } from '@/stores/drafts'
import { _resetDraftSessionMap } from '@/stores/chat-store/helpers/draft-promote'
import { dropSendReplay } from '@/stores/chat-store/helpers/send-replay'
import { switchToProjectSession } from '@/stores/chat-store/helpers/switch-to-session'
import { ProjectSidebarRow } from '@/components/sidebar/ProjectSidebarRow'

vi.mock('../../main/database', () => ({ getDb: () => db }))
vi.mock('../../main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))

const path = 'remote:node:/work/app'
const text = 'Review the diagram'
const attachment = { id: 'diagram', mimeType: 'image/png', name: 'diagram.png', base64: 'aW1hZ2U=' }
const host = mapRemoteSessionRow({ sessionId: 'host', title: null, messageCount: 0, harnessId: 'claude' })
let directory: string
let db: Database.Database
let stop: () => void

function restart(): void {
  // Close the actual database and drop the state a new renderer cannot inherit.
  stop()
  for (const row of listFailedRemoteSends()) dropSendReplay(row.message.id)
  _resetDraftSessionMap()
  useDraftsStore.setState(useDraftsStore.getInitialState())
  useChatStore.setState({ activeProject: null, projectSessions: {}, agentTitles: {} })
  db.close()
  db = new Database(join(directory, 'desktop.db'))
  stop = startFailedRemoteSendRecovery()
}

beforeEach(() => {
  _resetDraftSessionMap()
  useDraftsStore.setState(useDraftsStore.getInitialState())
  directory = mkdtempSync(join(tmpdir(), 'superone-failed-send-'))
  db = new Database(join(directory, 'desktop.db'))
  runDatabaseMigrations(db)
  window.app.listPlatforms = vi.fn().mockResolvedValue([])
  window.app.codexListModels = vi.fn().mockResolvedValue([])
  window.environment.listFailedRemoteSends = async () => listFailedRemoteSends()
  window.environment.saveFailedRemoteSend = async record => saveFailedRemoteSend(record)
  window.environment.resolveFailedRemoteSend = async (...args) => resolveFailedRemoteSend(...args)
  window.environment.listProjects = vi.fn().mockResolvedValue([{ projectId: 'project', path: '/work/app' }])
  window.environment.getSession = vi.fn().mockResolvedValue(null)
  window.environment.createSession = vi.fn().mockResolvedValue(host)
  window.environment.sendSessionMessage = vi.fn().mockResolvedValue({ sessionId: 'host' })
  const project = createDefaultProjectState()
  project._activeSessionId = 'origin'
  project._sessions.origin = { ...createDefaultPerSessionState(), draftId: 'saved-draft',
    preferredProvider: 'claude', selectedModel: 'chosen', attachments: [attachment] }
  useChatStore.setState({ activeProject: path, projectSessions: { [path]: project } })
  stop = startFailedRemoteSendRecovery()
})

afterEach(() => {
  cleanup()
  stop()
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

it.each(['edit', 'retry before creation', 'retry after creation'] as const)(
  'restores the failed conversation from disk while offline (%s)', async action => {
    const hosted = action === 'retry after creation'
    const sessionId = hosted ? 'host' : 'origin'
    const failure = 'WebSocket closed before acknowledgement'
    if (hosted) vi.mocked(window.environment.sendSessionMessage).mockRejectedValueOnce(new Error(failure))
    else vi.mocked(window.environment.createSession).mockRejectedValueOnce(new Error(failure))
    await useChatStore.getState().sendMessage(text)
    const [record] = listFailedRemoteSends()
    expect(record).toMatchObject({ projectPath: path, sessionId, hostSessionOwned: hosted, message: {
      attachments: [attachment], metadata: { sendFailure: { error: failure } },
    } })
    vi.mocked(window.environment.getSession).mockRejectedValue(new Error('Still offline'))
    vi.mocked(window.environment.sendSessionMessage).mockClear()
    restart()
    await vi.waitFor(() => expect(useChatStore.getState().projectSessions[path]?._sessions[sessionId]).toBeDefined())
    expect(window.environment.sendSessionMessage).not.toHaveBeenCalled()
    const openSession = vi.fn((folder: string, id: string) => switchToProjectSession(useChatStore.getState, folder, id))
    const view = render(<ProjectSidebarRow folder={{ id: 'project', path, name: 'app', addedAt: '', lastOpened: '' }}
      sessions={[]} isExpanded offline onSwitchSession={openSession} onPinSession={vi.fn()} onSettleSession={vi.fn()}
      onRenameSession={vi.fn()} onDeleteSession={vi.fn()} onEditProject={vi.fn()} onRemoveProject={vi.fn()}
      onToggleExpand={vi.fn()} onNewSession={vi.fn()} />)
    const row = view.getByText(text)
    await act(async () => {
      fireEvent.click(row)
      expect(openSession).toHaveBeenCalledWith(path, sessionId, expect.anything())
      await openSession.mock.results[0].value
    })
    view.unmount()
    const recovered = useChatStore.getState().projectSessions[path]._sessions[sessionId]
    expect(recovered).toMatchObject({ selectedModel: 'chosen', messages: [record.message] })
    if (action === 'edit') {
      useChatStore.getState().editFailedMessage(record.message.id)
      expect(useChatStore.getState().projectSessions[path]._sessions[sessionId]).toMatchObject({ draftText: text, attachments: [attachment] })
      restart()
      expect(listPendingDrafts('node')).toMatchObject([{ draft: {
        id: 'saved-draft', text, attachments: [{ id: 'diagram', data: attachment.base64 }],
      } }])
    } else {
      if (!hosted) {
        // A second failure replaces the saved reason and keeps one message.
        await useChatStore.getState().resendFailedMessage(record.message.id)
        expect(listFailedRemoteSends()).toMatchObject([{ message: { id: record.message.id, metadata: { sendFailure: { error: 'Still offline' } } } }])
      }
      vi.mocked(window.environment.getSession).mockResolvedValue(hosted ? host : null)
      vi.mocked(window.environment.createSession).mockClear()
      await useChatStore.getState().resendFailedMessage(record.message.id)
      expect(window.environment.createSession).toHaveBeenCalledTimes(hosted ? 0 : 1)
      expect(window.environment.sendSessionMessage).toHaveBeenCalledOnce()
      expect(window.environment.sendSessionMessage).toHaveBeenCalledWith('node', expect.objectContaining({
        sessionId: 'host', clientMessageId: record.message.id, text, images: [attachment],
      }))
      restart()
    }
    expect(listFailedRemoteSends()).toEqual([])
    await Promise.resolve()
    expect(useChatStore.getState().projectSessions[path]).toBeUndefined()
  },
)

it('keeps the failure if the edited draft cannot be saved', async () => {
  vi.mocked(window.environment.createSession).mockRejectedValueOnce(new Error('Node offline'))
  await useChatStore.getState().sendMessage(text)
  const [record] = listFailedRemoteSends()
  db.exec(`CREATE TEMP TRIGGER fail_draft BEFORE INSERT ON pending_drafts
    BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END`)
  expect(() => resolveFailedRemoteSend(path, record.message.id, { id: 'edited', text })).toThrow('simulated disk failure')
  restart()
  expect(listFailedRemoteSends()).toEqual([record])
  expect(listPendingDrafts('node')).toEqual([])
})

it('skips recovery writes for a successful first send', async () => {
  const save = vi.spyOn(window.environment, 'saveFailedRemoteSend')
  const resolve = vi.spyOn(window.environment, 'resolveFailedRemoteSend')
  await useChatStore.getState().sendMessage(text)
  expect(window.environment.sendSessionMessage).toHaveBeenCalledOnce()
  expect(save).not.toHaveBeenCalled()
  expect(resolve).not.toHaveBeenCalled()
})

it('discards a saved error when the node has already confirmed the same message at startup', async () => {
  vi.mocked(window.environment.sendSessionMessage).mockRejectedValueOnce(new Error('Connection lost'))
  await useChatStore.getState().sendMessage(text)
  const [record] = listFailedRemoteSends()
  restart()
  const project = createDefaultProjectState()
  const delivered = { ...record.message, providerId: 'claude', metadata: {} }
  project._sessions.host = { ...createDefaultPerSessionState(), messages: [delivered], hostSessionOwned: true }
  useChatStore.setState({ projectSessions: { [path]: project } })
  await vi.waitFor(() => expect(listFailedRemoteSends()).toEqual([]))
  expect(useChatStore.getState().projectSessions[path]._sessions.host.messages).toEqual([delivered])
})
