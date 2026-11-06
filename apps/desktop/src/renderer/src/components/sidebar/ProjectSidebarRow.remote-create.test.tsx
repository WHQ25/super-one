/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { ensureHostSession } from '@/stores/chat-store/helpers/session-turn'
import { createSendWriteScope } from '@/stores/chat-store/helpers/send-write-scope'
import { mapRemoteSessionRow } from '../../../../main/environment/remote-session-row'
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
