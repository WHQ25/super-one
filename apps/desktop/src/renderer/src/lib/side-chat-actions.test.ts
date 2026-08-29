import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessId } from '@superone/shared/agent-types'

const addUserSelection = vi.fn()

const storeState: {
  activeProject: string | null
  projectSessions: Record<string, {
    _activeSessionId: string | null
    _sessions: Record<string, {
      messages: unknown[]
      sessionProvider: HarnessId | null
      preferredProvider: HarnessId
      _sideChatParentId?: string | null
    }>
  }>
  addUserSelection: typeof addUserSelection
} = { activeProject: null, projectSessions: {}, addUserSelection }

vi.mock('@/stores/chat', () => ({
  useChatStore: Object.assign(
    (selector: (s: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState },
  ),
}))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), loading: vi.fn(() => 'toast-id'), dismiss: vi.fn() }),
}))

vi.mock('i18next', () => ({ default: { t: (key: string) => key } }))

const sideChatStore: {
  current: { sessionId: string; parentSessionId: string; projectPath: string; harnessId: HarnessId } | null
} = { current: null }
const openSideChat = vi.fn()
const closeSideChatStore = vi.fn()
const askConfirm = vi.fn()
const shouldSkipCloseConfirm = vi.fn(() => false)

vi.mock('@/stores/side-chat', () => ({
  useSideChatStore: { getState: () => ({ ...sideChatStore, askConfirm }) },
  openSideChat: (...args: unknown[]) => openSideChat(...args),
  closeSideChat: (...args: unknown[]) => closeSideChatStore(...args),
  shouldSkipCloseConfirm: () => shouldSkipCloseConfirm(),
}))

const openSideChatTab = vi.fn()
const closeSideChatTab = vi.fn()
vi.mock('@/components/activity/activity-panel-api', () => ({
  openSideChatTab: (...args: unknown[]) => openSideChatTab(...args),
  closeSideChatTab: () => closeSideChatTab(),
  focusActivePanelContent: vi.fn(),
}))

import { handleSideChatTabRemoved, requestCloseSideChat, requestSideChat, resolveSideChatTarget } from './side-chat-actions'

const PROJECT = '/repo'

function seed(over: Partial<{
  projectPath: string
  provider: HarnessId
  messages: number
  sideChatParent: string | null
}> = {}) {
  const projectPath = over.projectPath ?? PROJECT
  storeState.activeProject = projectPath
  storeState.projectSessions = {
    [projectPath]: {
      _activeSessionId: 'sid',
      _sessions: {
        sid: {
          messages: Array.from({ length: over.messages ?? 2 }, () => ({})),
          sessionProvider: over.provider ?? 'claude',
          preferredProvider: over.provider ?? 'claude',
          _sideChatParentId: over.sideChatParent ?? null,
        },
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  storeState.activeProject = null
  storeState.projectSessions = {}
  sideChatStore.current = null
  shouldSkipCloseConfirm.mockReturnValue(false)
  askConfirm.mockResolvedValue(true)
  openSideChat.mockResolvedValue({
    ok: true,
    chat: { sessionId: 'new-side', parentSessionId: 'sid', projectPath: PROJECT, harnessId: 'claude' },
  })
})

const OPEN_SIDE_CHAT = { sessionId: 'side-1', parentSessionId: 'sid', projectPath: PROJECT, harnessId: 'claude' as HarnessId }

describe('who may open a side chat', () => {
  it('accepts a local session on a forkable harness', () => {
    seed()
    expect(resolveSideChatTarget()).toEqual({ projectPath: PROJECT, sessionId: 'sid' })
  })

  it.each(['acp', 'cursor'] as const)('refuses %s, which has no transcript fork', (provider) => {
    seed({ provider })
    expect(resolveSideChatTarget()).toBeNull()
  })

  it('refuses an empty draft, which has no conversation to branch', () => {
    seed({ messages: 0 })
    expect(resolveSideChatTarget()).toBeNull()
  })

  it('refuses to branch a side chat off a side chat', () => {
    seed({ sideChatParent: 'parent-sid' })
    expect(resolveSideChatTarget()).toBeNull()
  })

  it('refuses a remote project, where the fork would run on the node', () => {
    seed({ projectPath: 'remote:conn-1:/srv/repo' })
    expect(resolveSideChatTarget()).toBeNull()
  })

  it('refuses when no project is open', () => {
    expect(resolveSideChatTarget()).toBeNull()
  })
})

describe('asking in an open side chat', () => {
  it('adds to the running thread instead of forking a second one', async () => {
    seed()
    sideChatStore.current = OPEN_SIDE_CHAT

    await requestSideChat({ quote: 'explain this', reuseOpen: true })

    expect(askConfirm).not.toHaveBeenCalled()
    expect(openSideChat).not.toHaveBeenCalled()
    expect(openSideChatTab).toHaveBeenCalledWith(PROJECT, 'side-1', expect.any(String))
    expect(addUserSelection).toHaveBeenCalledWith('explain this', {
      projectPath: PROJECT,
      sessionId: 'side-1',
    })
  })

  it('starts one when none is open', async () => {
    seed()

    await requestSideChat({ quote: 'explain this', reuseOpen: true })

    expect(openSideChat).toHaveBeenCalledWith(PROJECT, 'sid')
    expect(addUserSelection).toHaveBeenCalledWith('explain this', {
      projectPath: PROJECT,
      sessionId: 'new-side',
    })
  })

  it('still confirms a replace for an explicit new side chat', async () => {
    seed()
    sideChatStore.current = OPEN_SIDE_CHAT

    await requestSideChat()

    expect(askConfirm).toHaveBeenCalledWith('replace')
    expect(openSideChat).toHaveBeenCalledWith(PROJECT, 'sid')
  })
})

describe('closing a side chat', () => {
  it('asks, then drops the tab — the tab is what ends the session', async () => {
    sideChatStore.current = OPEN_SIDE_CHAT

    await requestCloseSideChat()

    expect(askConfirm).toHaveBeenCalledWith('close')
    expect(closeSideChatTab).toHaveBeenCalled()
    // Disposal rides the dock's removal event, so doing it here as well would
    // race that listener rather than reinforce it.
    expect(closeSideChatStore).not.toHaveBeenCalled()
  })

  it('leaves the tab alone when the confirm is cancelled', async () => {
    sideChatStore.current = OPEN_SIDE_CHAT
    askConfirm.mockResolvedValue(false)

    await requestCloseSideChat()

    expect(closeSideChatTab).not.toHaveBeenCalled()
  })

  it('goes straight through once the user has ticked "don\'t ask again"', async () => {
    sideChatStore.current = OPEN_SIDE_CHAT
    shouldSkipCloseConfirm.mockReturnValue(true)

    await requestCloseSideChat()

    expect(askConfirm).not.toHaveBeenCalled()
    expect(closeSideChatTab).toHaveBeenCalled()
  })
})

describe('handleSideChatTabRemoved', () => {
  it('disposes the session whose tab went away, however it went away', async () => {
    sideChatStore.current = OPEN_SIDE_CHAT

    await handleSideChatTabRemoved(OPEN_SIDE_CHAT.sessionId)

    expect(closeSideChatStore).toHaveBeenCalled()
  })

  it('ignores a stale tab so restoring an old layout cannot kill the live chat', async () => {
    sideChatStore.current = OPEN_SIDE_CHAT

    await handleSideChatTabRemoved('a-side-chat-replaced-long-ago')

    expect(closeSideChatStore).not.toHaveBeenCalled()
  })
})
