/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { SessionControlHolder } from '@superone/shared/environment'
import { sessionControlLeaseFixture } from './chat-store/session-control.test-fixtures'

vi.mock('./app', () => ({
  useAppStore: { getState: () => ({ getWorktreeState: () => ({}), setActiveWorktree: vi.fn(), clearWorktree: vi.fn().mockResolvedValue(undefined) }) },
}))
vi.mock('@/lib/session-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/session-client')>(),
  loadStoredSession: vi.fn().mockResolvedValue(null),
}))

const getLiveSnapshots = vi.fn()
const storage = { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() }
const events = new EventTarget()
vi.stubGlobal('window', {
  agent: { getLiveSnapshots },
  app: { worktreeExists: vi.fn().mockResolvedValue(true), saveSessionState: vi.fn().mockResolvedValue(undefined) },
  localStorage: storage,
  dispatchEvent: (e: Event) => events.dispatchEvent(e),
  addEventListener: (t: string, h: EventListenerOrEventListenerObject) => events.addEventListener(t, h),
  removeEventListener: (t: string, h: EventListenerOrEventListenerObject) => events.removeEventListener(t, h),
})
vi.stubGlobal('localStorage', storage)

const { useChatStore, isRemoteSession, createDefaultPerSessionState, createDefaultProjectState } = await import('./chat')
const { isControlledElsewhere } = await import('./chat-store/helpers/remote-control')

const remoteKey = 'remote:b:/Users/b/app'
const controller: SessionControlHolder = { kind: 'controller', label: 'Desktop A' }
const hostWindow: SessionControlHolder = { kind: 'window', label: null }

function seed(projectPath: string): void {
  useChatStore.setState({ activeProject: projectPath, projectSessions: {
    [projectPath]: { ...createDefaultProjectState(), _activeSessionId: 's', _sessions: { s: createDefaultPerSessionState() } },
  } })
}
const session = (projectPath: string) => useChatStore.getState().projectSessions[projectPath]._sessions.s
/** A controller desktop's lease: its own client, no delegate of this desktop. */
const controllerLease = { ...sessionControlLeaseFixture('s'), delegate: undefined, holderClientId: 'client-a' }
const controlChanged = (projectPath: string, delegate: string | undefined, holder?: SessionControlHolder): AgentEvent => ({
  type: 'session_control_changed', projectPath, sessionId: 's', harnessId: 'claude',
  lease: delegate ? sessionControlLeaseFixture('s', delegate) : controllerLease,
  ...(holder ? { holder } : {}),
})

beforeEach(() => { getLiveSnapshots.mockReset() })

describe('who drives a session elsewhere', () => {
  it("names a controller desktop holding one of this computer's sessions, and forgets it when the window takes it", () => {
    seed('/p')
    useChatStore.getState().handleAgentEvent(controlChanged('/p', undefined, controller))
    expect(session('/p').controlHolder).toEqual(controller)
    expect(isRemoteSession(useChatStore.getState(), '/p', 's')).toBe(true)

    useChatStore.getState().handleAgentEvent(controlChanged('/p', 'window:1', hostWindow))
    expect(session('/p').controlHolder).toBeNull()
    expect(isRemoteSession(useChatStore.getState(), '/p', 's')).toBe(false)
  })

  it('restores the holder with the lease from live snapshots', async () => {
    seed('/p')
    const base = createDefaultPerSessionState()
    getLiveSnapshots.mockResolvedValue([{ sid: 's', projectPath: '/p', isActive: true, isStreaming: false, permissionMode: 'default',
      sandboxInfo: { enabled: false, autoAllowBash: false }, uiSettings: {}, pendingInteractions: [], replayEvents: [],
      controlLease: controllerLease,
      controlHolder: controller,
      snapshot: { id: 's', projectPath: '/p', cwd: '/p', providerId: 'claude', harnessId: 'claude', status: 'idle', currentMessageId: null,
        messages: base.messages, totalCostUsd: 0, contextTokens: 0, title: null, worktreePath: null, gitBranch: null, worktreeMissing: false } }])
    await useChatStore.getState().syncLiveSnapshots()
    expect(session('/p').controlHolder).toEqual(controller)
  })

  it("follows the host's word on a remote session, which this desktop's own presence does not overwrite", () => {
    seed(remoteKey)
    useChatStore.getState().handleAgentEvent({ type: 'session_control_holder', holder: hostWindow, projectPath: remoteKey, sessionId: 's' })
    expect(session(remoteKey).controlHolder).toEqual(hostWindow)
    expect(isControlledElsewhere(session(remoteKey))).toBe(true)

    // A phone this desktop relays let go of it: that says nothing about who drives it there.
    useChatStore.getState().handleAgentEvent(controlChanged(remoteKey, 'phone:p'))
    useChatStore.getState().handleAgentEvent({ ...controlChanged(remoteKey, 'phone:p'), lease: null } as AgentEvent)
    expect(session(remoteKey).controlHolder).toEqual(hostWindow)

    useChatStore.getState().handleAgentEvent({ type: 'session_control_holder', holder: null, projectPath: remoteKey, sessionId: 's' })
    expect(session(remoteKey).controlHolder).toBeNull()
    expect(isControlledElsewhere(session(remoteKey))).toBe(false)
  })
})
