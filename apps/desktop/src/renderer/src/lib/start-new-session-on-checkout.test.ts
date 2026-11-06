/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectRef } from '@superone/shared/environment'
import type { EnvironmentBucket } from '@/lib/multi-host/types'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useMultiHostSidebarStore } from '@/stores/multi-host-sidebar'
import {
  checkoutTargetForNewSession,
  startNewSessionOnCheckout,
} from './start-new-session-on-checkout'

const LOCAL = '/src/super-one'
const REMOTE = 'remote:node-1:/srv/super-one'

function bucket(
  environmentId: string,
  connectionId: string,
  projectId: string,
  pathKey: string,
  hostPath: string,
): EnvironmentBucket {
  return {
    environmentId,
    connectionId,
    label: environmentId,
    kind: connectionId === 'local' ? 'local' : 'cli-node',
    connection: 'connected',
    projectsStatus: 'ready',
    projectsError: null,
    checkouts: [{
      ref: projectRef(environmentId, projectId),
      environmentId,
      connectionId,
      projectId,
      name: 'super-one',
      pathKey,
      hostPath,
      repoIdentity: null,
      addedAt: 0,
      lastOpened: 0,
    }],
  }
}

const localBucket = bucket('desktop', 'local', 'local-project', LOCAL, LOCAL)
const remoteBucket = bucket('server', 'node-1', 'remote-project', REMOTE, '/srv/super-one')

function activeSession(path: string) {
  const project = useChatStore.getState().projectSessions[path]
  const sessionId = project?._activeSessionId
  return sessionId ? project._sessions[sessionId] : undefined
}

describe('checkout named by a new-session button', () => {
  it('keeps a local project on this machine and uses the catalog environment', () => {
    expect(checkoutTargetForNewSession(LOCAL, [localBucket, remoteBucket])).toEqual({
      pathKey: LOCAL,
      connectionId: 'local',
      projectId: 'local-project',
      environmentId: 'desktop',
    })
  })

  it('uses the clicked remote environment id rather than the connection id in the path', () => {
    expect(checkoutTargetForNewSession(REMOTE, [localBucket, remoteBucket])).toEqual({
      pathKey: REMOTE,
      connectionId: 'node-1',
      projectId: 'remote-project',
      environmentId: 'server',
    })
  })

  it('still opens a local path on this machine when the catalog has not listed it', () => {
    expect(checkoutTargetForNewSession('/elsewhere', [remoteBucket], 'known')).toEqual({
      pathKey: '/elsewhere',
      connectionId: 'local',
      projectId: 'known',
      environmentId: 'local',
    })
  })
})

describe('new session on the clicked checkout', () => {
  beforeEach(() => {
    useChatStore.setState({ activeProject: null, projectSessions: {} })
    useAppStore.setState({
      experimentalRemoteNodesEnabled: true,
      selectedHostConnectionId: 'local',
      currentFolder: null,
      currentProjectId: null,
    })
    useMultiHostSidebarStore.setState({ environments: [localBucket, remoteBucket] })
    Object.assign(window.app, {
      openFolder: vi.fn(async () => true),
      getRecentFolders: vi.fn(async () => []),
      activateWorktree: vi.fn(async () => ({ ok: true })),
      getProjectId: vi.fn(async () => 'local-project'),
    })
    Object.assign(window.environment, {
      openProject: vi.fn(async () => ({ projectId: 'remote-project', path: '/srv/super-one', name: 'super-one' })),
      callSession: vi.fn(async () => null),
    })
  })

  it('switches an open new-session page onto the clicked environment', async () => {
    useChatStore.getState().ensureSession(LOCAL)
    useChatStore.setState({ activeProject: LOCAL })
    const localId = useChatStore.getState().projectSessions[LOCAL]!._activeSessionId!
    useChatStore.setState((state) => ({
      projectSessions: {
        ...state.projectSessions,
        [LOCAL]: {
          ...state.projectSessions[LOCAL]!,
          _sessions: {
            ...state.projectSessions[LOCAL]!._sessions,
            [localId]: {
              ...state.projectSessions[LOCAL]!._sessions[localId]!,
              environmentSelection: { environmentId: 'desktop', selection: { kind: 'local' } },
            },
          },
        },
      },
    }))

    await startNewSessionOnCheckout(REMOTE)

    expect(window.environment.openProject).toHaveBeenCalledWith('node-1', '/srv/super-one')
    expect(useChatStore.getState().activeProject).toBe(REMOTE)
    expect(useAppStore.getState().selectedHostConnectionId).toBe('node-1')
    expect(activeSession(REMOTE)?.environmentSelection).toEqual({
      environmentId: 'server',
      selection: { kind: 'local' },
    })
    expect(Object.keys(useChatStore.getState().projectSessions[LOCAL]!._sessions)).toEqual([localId])
  })

  it('opens the local checkout while another host is selected', async () => {
    useChatStore.getState().ensureSession(REMOTE)
    useChatStore.setState({ activeProject: REMOTE })
    useAppStore.setState({ selectedHostConnectionId: 'node-1', currentFolder: REMOTE })

    await startNewSessionOnCheckout(LOCAL)

    expect(window.app.openFolder).toHaveBeenCalledWith(LOCAL)
    expect(window.environment.openProject).not.toHaveBeenCalled()
    expect(useChatStore.getState().activeProject).toBe(LOCAL)
    expect(useAppStore.getState().selectedHostConnectionId).toBe('local')
    expect(activeSession(LOCAL)?.environmentSelection).toEqual({
      environmentId: 'desktop',
      selection: { kind: 'local' },
    })
  })

  it('keeps typed text when the new-session page moves to another environment', async () => {
    useChatStore.getState().ensureSession(LOCAL)
    useChatStore.setState({ activeProject: LOCAL })
    const localId = useChatStore.getState().projectSessions[LOCAL]!._activeSessionId!
    useChatStore.setState((state) => ({
      projectSessions: {
        ...state.projectSessions,
        [LOCAL]: {
          ...state.projectSessions[LOCAL]!,
          _sessions: {
            ...state.projectSessions[LOCAL]!._sessions,
            [localId]: {
              ...state.projectSessions[LOCAL]!._sessions[localId]!,
              draftText: 'take this prompt',
            },
          },
        },
      },
    }))

    await startNewSessionOnCheckout(REMOTE)

    expect(activeSession(REMOTE)?.draftText).toBe('take this prompt')
    expect(activeSession(REMOTE)?.environmentSelection?.environmentId).toBe('server')
    expect(activeSession(LOCAL)?.draftText).toBe('')
  })

  it('mints a new session when the clicked checkout is already in a conversation', async () => {
    useChatStore.getState().ensureSession(REMOTE)
    const remoteId = useChatStore.getState().projectSessions[REMOTE]!._activeSessionId!
    useChatStore.setState((state) => ({
      activeProject: LOCAL,
      projectSessions: {
        ...state.projectSessions,
        [REMOTE]: {
          ...state.projectSessions[REMOTE]!,
          _sessions: {
            ...state.projectSessions[REMOTE]!._sessions,
            [remoteId]: {
              ...state.projectSessions[REMOTE]!._sessions[remoteId]!,
              messages: [{
                id: 'started',
                role: 'user',
                status: 'complete',
                content: [],
                createdAt: '',
                providerId: 'claude',
              }],
            },
          },
        },
      },
    }))
    useChatStore.getState().ensureSession(LOCAL)
    useChatStore.setState({ activeProject: LOCAL })

    await startNewSessionOnCheckout(REMOTE)

    const nextId = useChatStore.getState().projectSessions[REMOTE]!._activeSessionId
    expect(nextId).not.toBe(remoteId)
    expect(activeSession(REMOTE)?.messages).toEqual([])
    expect(activeSession(REMOTE)?.environmentSelection?.environmentId).toBe('server')
  })
})
