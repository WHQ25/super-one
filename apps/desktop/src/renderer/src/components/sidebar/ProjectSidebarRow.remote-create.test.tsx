/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { ensureHostSession } from '@/stores/chat-store/helpers/session-turn'
import { createSendWriteScope } from '@/stores/chat-store/helpers/send-write-scope'
import { mapRemoteSessionRow } from '../../../../main/environment/remote-session-row'
import { DraftsSection } from './DraftsSection'
import { useDraftsStore } from '@/stores/drafts'
import { _resetDraftSessionMap, claimDraftForSession } from '@/stores/chat-store/helpers/draft-promote'
import { ProjectSidebarRow } from './ProjectSidebarRow'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'

const PATH = 'remote:node:/work/app'
const TITLE = 'Fix the remote sidebar'
type CreatedSession = Awaited<ReturnType<typeof window.environment.createSession>>
const callbacks = {
  onSwitchSession: vi.fn(), onPinSession: vi.fn(), onSettleSession: vi.fn(),
  onRenameSession: vi.fn(), onDeleteSession: vi.fn(), onToggleExpand: vi.fn(),
  onEditProject: vi.fn(), onRemoveProject: vi.fn(), onNewSession: vi.fn(),
}

beforeEach(() => {
  window.app.listAutomations = vi.fn(async () => [])
  window.agent.activateSession = vi.fn(async () => undefined)
  window.environment.getSession = vi.fn(async () => null)
  window.environment.listProjects = vi.fn(async () => [{ projectId: 'project', path: '/work/app', name: 'Remote project' }])
  useChatStore.setState({ activeProject: PATH, projectSessions: {}, agentTitles: {} })
  useCodexRealtimeViewStore.setState({ sessions: {} })
})

it.each(['named', 'message', 'parent', 'child', 'pinned', 'resume', 'streaming', 'voice', 'foreground', 'local'])('keeps an empty-looking row with %s evidence', (evidence) => {
  const path = evidence === 'local' ? '/work/app' : PATH
  const project = createDefaultProjectState()
  if (evidence === 'foreground') project._activeSessionId = 'host'
  if (evidence === 'streaming') project._sessions.host = { ...createDefaultPerSessionState(), status: 'streaming', _historyHydrated: false }
  useChatStore.setState({ activeProject: path, projectSessions: { [path]: project } })
  if (evidence === 'voice') useCodexRealtimeViewStore.getState().setTimeline('host', {
    segments: [], threadMessages: [], activeRealtimeSessionId: null, hasTimeline: true,
  })
  const row = mapRemoteSessionRow({ sessionId: 'host', title: evidence === 'named' ? 'Voice chat' : null,
    messageCount: evidence === 'message' ? 1 : 0,
    ...(evidence === 'parent' ? { childCount: 1 } : {}),
    ...(evidence === 'child' ? { parentSessionId: 'parent' } : {}),
    ...(evidence === 'pinned' ? { isPinned: true } : {}),
    ...(evidence === 'resume' ? { providerSessionId: 'thread' } : {}),
  })
  const { container } = render(<ProjectSidebarRow {...callbacks}
    folder={{ id: 'project', path, name: 'Remote project', addedAt: '', lastOpened: '' }}
    sessions={[row]} isExpanded />)
  expect(container.querySelectorAll('.group\\/session')).toHaveLength(1)
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('retains an attachment-only failed session even without a hydrated title', () => {
  const project = createDefaultProjectState()
  project._sessions.origin = {
    ...createDefaultPerSessionState(), _historyHydrated: false,
    messages: [{ id: 'user', role: 'user', status: 'complete', createdAt: '', providerId: 'local',
      content: [{ type: 'image', name: 'diagram.png' }], metadata: { sendFailure: { error: 'Disconnected' } } }],
  }
  useChatStore.setState({ projectSessions: { [PATH]: project } })
  const { container } = render(<ProjectSidebarRow {...callbacks}
    folder={{ id: 'project', path: PATH, name: 'Remote project', addedAt: '', lastOpened: '' }}
    sessions={[]} isExpanded offline />)
  expect(container.querySelectorAll('.group\\/session')).toHaveLength(1)
})

it.each(['fill', 'cap'] as const)('keeps one row while a remote create notice races the first send (%s layout)', async (layout) => {
  const project = createDefaultProjectState()
  project._activeSessionId = 'draft'
  project._sessions.draft = {
    ...createDefaultPerSessionState(), preferredProvider: 'claude', awaitingAssistantReply: true,
    messages: [{ id: 'user', providerId: 'local', role: 'user', status: 'complete', createdAt: '',
      content: [{ type: 'text', text: TITLE }] }],
  }
  useChatStore.setState({ projectSessions: { [PATH]: project } })
  let finishCreate!: (value: CreatedSession) => void
  window.environment.createSession = vi.fn(() => new Promise<CreatedSession>((resolve) => { finishCreate = resolve }))
  const row = mapRemoteSessionRow({ sessionId: 'host', title: null, messageCount: 0, harnessId: 'claude' })
  const sidebar = (sessions: typeof row[]) => <ProjectSidebarRow {...callbacks}
    folder={{ id: 'project', path: PATH, name: 'Remote project', addedAt: '', lastOpened: '' }}
    sessions={sessions} isExpanded sessionListLayout={layout} />
  const { container, rerender } = render(sidebar([]))
  expect(screen.getByText(TITLE)).toBeInTheDocument()

  const scope = createSendWriteScope(useChatStore.setState, useChatStore.getState, PATH)
  const creating = ensureHostSession(useChatStore.setState, useChatStore.getState, PATH, scope)
  await vi.waitFor(() => expect(window.environment.createSession).toHaveBeenCalledOnce())
  // The host publishes session.created before create returns: settings and cwd
  // still require round trips. The first bubble is still under the draft id.
  rerender(sidebar([row]))
  expect(screen.queryByText('New session')).toBeNull()
  expect(container.querySelectorAll('.group\\/session')).toHaveLength(1)

  await act(async () => { finishCreate(row); await creating })
  expect(useChatStore.getState().projectSessions[PATH]._activeSessionId).toBe('host')
  expect(screen.getByText(TITLE)).toBeInTheDocument()
  expect(container.querySelectorAll('.group\\/session')).toHaveLength(1)

  // A later list update contains the accepted first message, followed by reply activity.
  rerender(sidebar([{ ...row, title: TITLE, messageCount: 1 }]))
  act(() => useChatStore.getState().handleAgentEvent({ type: 'session_activity', activity: {
    sessionId: 'host', projectPath: PATH, title: TITLE, status: 'streaming', provider: 'claude',
    pendingCount: 0, pendingReason: { en: null, zh: null },
  } }))
  expect(container.querySelectorAll('.group\\/session')).toHaveLength(1)
  expect(screen.queryByText('New session')).toBeNull()
})

it.each(['accepted', 'create refused, edit', 'create refused, retry', 'send refused'] as const)(
  'keeps a background first send out of Drafts while the node is slow (%s)', async outcome => {
    const draft = {
      id: 'saved', originSessionId: 'previous-editor', projectPath: '/work/app', title: TITLE, text: TITLE,
      docJson: null, attachments: [], settings: {}, harness: null, model: null, permissionMode: null,
      createdAt: '', updatedAt: '',
    }
    const project = createDefaultProjectState()
    project._activeSessionId = 'origin'
    const saved = outcome !== 'create refused, retry'
    const attachment = { id: 'image', name: 'diagram.png', mimeType: 'image/png', base64: 'YWJj' }
    project._sessions.origin = {
      ...createDefaultPerSessionState(), preferredProvider: 'claude', draftId: saved ? draft.id : null,
      attachments: [attachment],
    }
    project._sessions.sibling = createDefaultPerSessionState()
    useChatStore.setState({ projectSessions: { [PATH]: project } })
    const drafts = saved ? [draft] : []
    useDraftsStore.setState({ byConnection: { node: drafts }, discardedIds: {} })
    if (saved) claimDraftForSession('origin', draft.id)
    window.environment.listDrafts = vi.fn(async () => drafts)
    window.environment.openRemoteSession = vi.fn().mockResolvedValue({ messages: [], state: {} })
    window.environment.resumeRemoteSessionEvents = vi.fn().mockResolvedValue(undefined)
    const create = Promise.withResolvers<CreatedSession>()
    const delivery = Promise.withResolvers<Awaited<ReturnType<typeof window.environment.sendSessionMessage>>>()
    const deletion = Promise.withResolvers<void>()
    window.environment.createSession = vi.fn(() => create.promise)
    window.environment.sendSessionMessage = vi.fn(() => delivery.promise)
    window.environment.deleteDraft = vi.fn(() => deletion.promise)
    const host = mapRemoteSessionRow({ sessionId: 'host', title: null, messageCount: 0, harnessId: 'claude' })
    const sidebar = (rows: typeof host[], offline = false) => <>
      <DraftsSection connectionIds={['node']} />
      <ProjectSidebarRow {...callbacks}
        folder={{ id: 'project', path: PATH, name: 'Remote project', addedAt: '', lastOpened: '' }}
        sessions={rows} isExpanded offline={offline} />
    </>
    const view = render(sidebar([]))
    let sending!: Promise<void>
    try {
      await act(async () => {
        sending = useChatStore.getState().sendMessage(TITLE)
        await useChatStore.getState().switchSession('sibling')
        await useDraftsStore.getState().loadDrafts('node')
      })
      const draftRow = () => view.container.querySelector('.group\\/draft')
      expect(draftRow()).toBeNull()
      expect(view.container.querySelector('.group\\/session')).toHaveTextContent(TITLE)
      if (outcome === 'create refused, edit' || outcome === 'create refused, retry') {
        const error = 'WebSocket closed before the session was created'
        await act(async () => { create.reject(new Error(error)); await sending })
        view.rerender(sidebar([], true))
        expect(draftRow()).toBeNull()
        expect(view.container.querySelector('.group\\/session')).toHaveTextContent(TITLE)
        expect(useChatStore.getState().projectSessions[PATH]._activeSessionId).toBe('sibling')
        expect(window.environment.deleteDraft).not.toHaveBeenCalled()
        vi.mocked(window.environment.getSession).mockClear()
        vi.mocked(window.environment.openRemoteSession).mockClear()
        await act(async () => { await useChatStore.getState().switchSession('origin') })
        expect(window.environment.getSession).not.toHaveBeenCalled()
        expect(window.environment.openRemoteSession).not.toHaveBeenCalled()
        const origin = () => useChatStore.getState().projectSessions[PATH]._sessions.origin
        const failed = origin().messages[0]
        expect(failed.metadata?.sendFailure?.error).toBe(error)
        const editedText = 'Send the updated diagram'
        window.environment.createSession = vi.fn().mockResolvedValue(host)
        window.environment.sendSessionMessage = vi.fn().mockResolvedValue({ sessionId: 'host' })
        await act(async () => {
          if (outcome === 'create refused, edit') {
            useChatStore.getState().editFailedMessage(failed.id)
            expect(origin().draftText).toBe(TITLE)
            expect(origin().attachments).toEqual([attachment])
            await useChatStore.getState().sendMessage(editedText)
          } else {
            await useChatStore.getState().resendFailedMessage(failed.id)
          }
        })
        expect(window.environment.sendSessionMessage).toHaveBeenCalledOnce()
        expect(window.environment.createSession).toHaveBeenCalledOnce()
        expect(window.environment.sendSessionMessage).toHaveBeenCalledWith('node', expect.objectContaining({
          sessionId: 'host', images: [attachment],
          ...(outcome === 'create refused, retry' ? { text: TITLE, clientMessageId: failed.id } : { text: editedText }),
        }))
        const after = useChatStore.getState().projectSessions[PATH]
        expect(after._sessions.origin).toBeUndefined()
        expect(after._sessions.host.messages).toHaveLength(1)
        expect(after._sessions.host.messages[0].metadata?.sendFailure).toBeUndefined()
        view.rerender(sidebar([host]))
        expect(view.container.querySelectorAll('.group\\/session')).toHaveLength(1)
        expect(draftRow()).toBeNull()
        return
      }
      await act(async () => { create.resolve(host) })
      view.rerender(sidebar([host]))
      await vi.waitFor(() => expect(window.environment.sendSessionMessage).toHaveBeenCalledOnce())
      expect(draftRow()).toBeNull()
      await act(async () => {
        if (outcome === 'send refused') delivery.reject(new Error('node offline'))
        else delivery.resolve({ sessionId: 'host' })
        await sending
      })
      expect(draftRow()).toBeNull()
      expect(view.container.querySelector('.group\\/session')).toHaveTextContent(TITLE)
      if (outcome === 'send refused') {
        window.environment.getSession = vi.fn().mockRejectedValue(new Error('still offline'))
        await act(async () => { await useChatStore.getState().switchSession('host') })
        expect(useChatStore.getState().projectSessions[PATH]._sessions.host.messages[0].metadata?.sendFailure?.error).toBe('node offline')
        window.environment.getSession = vi.fn().mockResolvedValue(host)
        await act(async () => { await useChatStore.getState().switchSession('host') })
        const failed = useChatStore.getState().projectSessions[PATH]._sessions.host.messages[0]
        expect(failed.metadata?.sendFailure?.error).toBe('node offline')
        window.environment.sendSessionMessage = vi.fn().mockResolvedValue({ sessionId: 'host' })
        await act(async () => { await useChatStore.getState().resendFailedMessage(failed.id) })
        expect(window.environment.sendSessionMessage).toHaveBeenCalledWith('node', expect.objectContaining({
          sessionId: 'host', clientMessageId: failed.id, text: TITLE,
        }))
        expect(useChatStore.getState().projectSessions[PATH]._sessions.host.messages).toHaveLength(1)
      }
    } finally {
      await act(async () => {
        create.resolve(host)
        delivery.resolve({ sessionId: 'host' })
        deletion.resolve()
        await sending
      })
      _resetDraftSessionMap()
    }
  },
)
