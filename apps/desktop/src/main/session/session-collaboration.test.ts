import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_AGENT_LAUNCHES_FIELD, type AgentEvent } from '@superone/shared/agent-types'
import type { Session, SessionCreateOptions, SessionManager } from './types'

const TEST_CWD = process.cwd()

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  enabled: true,
  activateWorktree: vi.fn(),
  resourceCache: {
    claude: {
      models: [{ id: 'test-model', name: 'Test Model', supportedEffortLevels: ['low', 'high'] }],
    },
  } as Record<string, unknown>,
  providers: [{
    id: 'claude-base', harnessId: 'claude', name: 'Claude', isBase: true, config: {}, createdAt: 0, updatedAt: 0,
  }],
  credentials: [{ id: 'api-1', name: 'Seed-lei', platformId: 'openai' }],
  platforms: [{ id: 'openai', name: 'OpenAI', brand: 'openai', plans: [] }],
  agentPreference: {
    claude: { defaultModel: 'test-model', defaultEffort: 'high' },
    codex: { defaultModel: '', defaultReasoningEffort: '' },
    acp: { selectedAgentId: null as string | null },
  },
}))

vi.mock('../app-settings-service', () => ({
  readAppSettings: () => ({
    experimentalAgentCollaborationEnabled: state.enabled,
    agentPreference: state.agentPreference,
  }),
}))
vi.mock('../logger', () => ({ default: { warn: vi.fn(), debug: vi.fn(), info: vi.fn() } }))
vi.mock('../database', () => ({
  getDb: () => state.db!,
  getCachedHarnessResources: (harnessId: string) => state.resourceCache[harnessId] ?? null,
}))
vi.mock('../crypto/secret-store', () => ({
  encryptSecret: (value: string) => `encrypted:${value}`,
  decryptSecret: (value: string) => value.replace(/^encrypted:/, ''),
}))
vi.mock('../providers/credential-store', () => ({
  listCredentials: () => state.credentials,
}))
vi.mock('../providers/registry', () => ({
  getPlatforms: () => state.platforms,
}))
vi.mock('../providers/resolver', () => ({
  resolveChatService: (_harness: string, credentialId: string) =>
    state.credentials.some((credential) => credential.id === credentialId)
      ? { credentialId }
      : null,
}))
vi.mock('./session-provider-repo', () => ({
  listSessionProviders: () => state.providers,
}))
vi.mock('../git/worktree-ops', () => ({
  activateWorktree: state.activateWorktree,
}))
vi.mock('../db-sessions', () => ({
  createSession: (projectPath: string, sessionId: string, title?: string) => {
    state.db!.prepare('INSERT INTO sessions (id, project_path, title) VALUES (?, ?, ?)').run(sessionId, projectPath, title ?? null)
    return sessionId
  },
}))

import {
  requestSessionAgents,
  listSessionAgentProfiles,
  getSessionCollaborationSystemPrompt,
  sendSessionMessage,
  startSessionAgent,
  waitForSessionMessages,
} from './session-collaboration'
import { resolveSessionAgentsConfirm } from './session-collaboration-confirm'

function resultJson(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text) as Record<string, any>
}

function createSchema(db: Database.Database): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      title TEXT,
      provider_id TEXT,
      provider TEXT,
      acp_agent_id TEXT
    );
    CREATE TABLE session_collaboration_grants (
      credential_hash TEXT PRIMARY KEY,
      credential_secret TEXT,
      credential_hint TEXT NOT NULL,
      parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      child_session_id TEXT UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      task TEXT NOT NULL,
      config_json TEXT NOT NULL,
      task_sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      started_at TEXT
    );
    CREATE TABLE session_collaboration_messages (
      id TEXT PRIMARY KEY,
      credential_hash TEXT NOT NULL REFERENCES session_collaboration_grants(credential_hash) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      sender_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      recipient_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      client_message_id TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      UNIQUE(credential_hash, sequence),
      UNIQUE(credential_hash, sender_session_id, client_message_id)
    );
    CREATE TABLE session_collaboration_cursors (
      credential_hash TEXT NOT NULL REFERENCES session_collaboration_grants(credential_hash) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      last_sequence INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(credential_hash, session_id)
    );
  `)
}

function fakeSession(id: string, events: AgentEvent[] = []): Session {
  const listeners = new Set<(event: AgentEvent) => void>()
  return {
    id,
    projectPath: TEST_CWD,
    cwd: TEST_CWD,
    snapshot: { id, providerId: 'claude-base', harnessId: 'claude', status: 'idle' } as never,
    emitHostEvent: vi.fn((event: AgentEvent) => events.push(event)),
    send: vi.fn(async () => {}),
    setTitle: vi.fn(),
    isStreaming: vi.fn(() => false),
    injectTaskNotification: vi.fn(async () => {}),
    appendTranscriptMessage: vi.fn(),
    on: vi.fn((handler: (event: AgentEvent) => void) => {
      listeners.add(handler)
      return () => { listeners.delete(handler) }
    }),
  } as unknown as Session
}

function fakeHost(parent: Session, options: { activeSessionId?: string | null } = {}) {
  const sessions = new Map<string, Session>([[parent.id, parent]])
  const createSession = vi.fn((options: SessionCreateOptions) => {
    const child = fakeSession(options.id!)
    sessions.set(child.id, child)
    return child
  })
  let activeId: string | null = options.activeSessionId === undefined ? parent.id : options.activeSessionId
  const host = {
    getSession: (id: string) => sessions.get(id) ?? null,
    getActiveSession: (projectPath: string) => {
      void projectPath
      return activeId ? sessions.get(activeId) ?? null : null
    },
    setActiveSession: (projectPath: string, sessionId: string) => {
      void projectPath
      if (!sessions.has(sessionId)) throw new Error(`Session not found: ${sessionId}`)
      activeId = sessionId
    },
    clearActiveSession: (projectPath: string) => {
      void projectPath
      activeId = null
    },
    createSession: vi.fn((options: SessionCreateOptions) => {
      const child = createSession(options)
      activeId = child.id
      return child
    }),
    disposeSession: vi.fn(async (id: string) => { sessions.delete(id) }),
    resumeSession: vi.fn((id: string) => {
      const existing = sessions.get(id)
      if (existing) return existing
      throw new Error(`Session ${id} not found`)
    }),
  } as unknown as SessionManager
  return { host, sessions, createSession: host.createSession as ReturnType<typeof vi.fn> }
}

async function approveLaunches(parent: Session, host: SessionManager, count = 1) {
  const promise = requestSessionAgents(parent.id, {
    launches: Array.from({ length: count }, (_, index) => ({
      launchId: `launch-${index}`,
      agentId: 'claude-base',
      task: `Task ${index}`,
      name: `Agent ${index}`,
      role: 'Worker',
      config: { cwd: TEST_CWD, model: 'test-model', effort: 'high' },
    })),
  }, host)
  const event = (parent.emitHostEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as AgentEvent
  if (event.type !== 'permission_request') throw new Error('Expected permission request')
  const launches = event.request.sessionAgentsConfirm!.launches
  resolveSessionAgentsConfirm(event.request.requestId, 'accept', {
    [SESSION_AGENT_LAUNCHES_FIELD]: JSON.stringify(launches),
  })
  return resultJson(await promise).launches as Array<{ launchId: string; agentId: string; credential: string }>
}

beforeEach(() => {
  state.db?.close()
  state.db = new Database(':memory:')
  createSchema(state.db)
  state.db.prepare('INSERT INTO sessions (id, project_path, title, provider_id) VALUES (?, ?, ?, ?)')
    .run('parent', TEST_CWD, 'Parent', 'claude-base')
  state.enabled = true
  state.activateWorktree.mockReset()
  state.resourceCache = {
    claude: {
      models: [
        { id: 'test-model', name: 'Test Model', supportedEffortLevels: ['low', 'high'] },
        { id: 'alternate-model', name: 'Alternate Model', supportedEffortLevels: ['low', 'high'] },
      ],
    },
  }
  state.providers = [{
    id: 'claude-base', harnessId: 'claude', name: 'Claude', isBase: true, config: {}, createdAt: 0, updatedAt: 0,
  }]
  state.credentials = [{ id: 'api-1', name: 'Seed-lei', platformId: 'openai' }]
  state.platforms = [{ id: 'openai', name: 'OpenAI', brand: 'openai', plans: [] }]
  state.agentPreference = {
    claude: { defaultModel: 'test-model', defaultEffort: 'high' },
    codex: { defaultModel: '', defaultReasoningEffort: '' },
    acp: { selectedAgentId: null },
  }
})

describe('session collaboration', () => {
  it('omits profiles that have never been used or lack an initialized model catalog', () => {
    expect(listSessionAgentProfiles()).toHaveLength(1)
    state.db!.prepare('UPDATE sessions SET provider_id = NULL').run()
    expect(listSessionAgentProfiles()).toEqual([])
    state.db!.prepare('UPDATE sessions SET provider_id = ?').run('claude-base')
    state.resourceCache = {}
    expect(listSessionAgentProfiles()).toEqual([])
  })

  it('labels API providers with the platform name and key entry metadata', () => {
    expect(listSessionAgentProfiles()).toEqual([
      expect.objectContaining({
        id: 'claude-base',
        apiProviders: [{
          id: 'api-1',
          name: 'OpenAI',
          brand: 'openai',
          keyName: 'Seed-lei',
        }],
      }),
    ])
  })

  it('formats Codex model ids into the same display names as the chat selector', () => {
    state.db!.prepare('UPDATE sessions SET provider_id = ?').run('codex-base')
    state.providers = [{
      id: 'codex-base', harnessId: 'codex', name: 'Codex', isBase: true, config: {}, createdAt: 0, updatedAt: 0,
    }]
    state.resourceCache = {
      codex: {
        models: [
          { id: 'gpt-5.6-sol', name: 'gpt-5.6-sol', supportedReasoningEfforts: [{ value: 'medium' }] },
          { id: 'custom-model', name: 'My Custom Model', supportedReasoningEfforts: [{ value: 'high' }] },
        ],
      },
    }
    state.agentPreference = {
      ...state.agentPreference,
      codex: { defaultModel: 'gpt-5.6-sol', defaultReasoningEffort: 'medium' },
    }

    expect(listSessionAgentProfiles()).toEqual([
      expect.objectContaining({
        id: 'codex-base',
        models: [
          expect.objectContaining({ id: 'gpt-5.6-sol', name: 'GPT5.6 Sol' }),
          expect.objectContaining({ id: 'custom-model', name: 'My Custom Model' }),
        ],
      }),
    ])
  })

  it('exposes the selected Grok model and effort as profile defaults', () => {
    state.db!.prepare('UPDATE sessions SET provider_id = ?').run('acp-base')
    state.providers = [{
      id: 'acp-base', harnessId: 'acp', name: 'Others (ACP)', isBase: true,
      config: { agentId: 'grok-build' }, createdAt: 0, updatedAt: 0,
    }]
    state.resourceCache = {
      acp: {
        selectedAgentId: 'grok-build',
        agents: [{ id: 'grok-build', name: 'Grok', installed: true, commandPreview: 'grok' }],
        configByAgentId: {
          'grok-build': {
            configOptions: [],
            extraModels: [{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }],
            selectedModelId: 'grok-4.5',
            modelConfigId: null,
            extraModes: [
              { id: 'low', name: 'Low', description: '' },
              { id: 'high', name: 'High', description: '' },
            ],
            selectedModeId: 'high',
            modeConfigId: null,
            updatedAt: new Date().toISOString(),
          },
        },
      },
    }

    expect(listSessionAgentProfiles()).toEqual([
      expect.objectContaining({
        id: 'acp-base',
        acpAgentId: 'grok-build',
        defaultConfig: { model: 'grok-4.5', effort: 'high' },
      }),
    ])
  })

  it('inherits profile defaults through approval and applies them to the initial task', async () => {
    const parent = fakeSession('parent')
    const { host, createSession } = fakeHost(parent)
    const promise = requestSessionAgents(parent.id, {
      launches: [{
        launchId: 'defaulted',
        agentId: 'claude-base',
        task: 'Use profile defaults',
        name: 'Defaults',
        role: 'Worker',
      }],
    }, host)
    const event = (parent.emitHostEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as AgentEvent
    if (event.type !== 'permission_request') throw new Error('Expected permission request')
    const launches = event.request.sessionAgentsConfirm!.launches
    expect(launches[0].config).toMatchObject({ model: 'test-model', effort: 'high' })
    resolveSessionAgentsConfirm(event.request.requestId, 'accept', {
      [SESSION_AGENT_LAUNCHES_FIELD]: JSON.stringify(launches),
    })

    const grants = resultJson(await promise).launches as Array<{ credential: string }>
    await startSessionAgent('parent', grants[0].credential, host)

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      model: 'test-model',
      effort: 'high',
    }))
    const child = createSession.mock.results[0]?.value as Session
    expect(child.send).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Use profile defaults',
      model: 'test-model',
      effort: 'high',
    }))
  })

  it('keeps an explicit agent model and effort ahead of profile defaults', async () => {
    const parent = fakeSession('parent')
    const { host } = fakeHost(parent)
    const promise = requestSessionAgents(parent.id, {
      launches: [{
        launchId: 'explicit',
        agentId: 'claude-base',
        task: 'Use explicit settings',
        name: 'Explicit',
        role: 'Worker',
        config: { model: 'alternate-model', effort: 'low' },
      }],
    }, host)
    const event = (parent.emitHostEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as AgentEvent
    if (event.type !== 'permission_request') throw new Error('Expected permission request')
    const launches = event.request.sessionAgentsConfirm!.launches
    expect(launches[0].config).toMatchObject({ model: 'alternate-model', effort: 'low' })
    resolveSessionAgentsConfirm(event.request.requestId, 'accept', {
      [SESSION_AGENT_LAUNCHES_FIELD]: JSON.stringify(launches),
    })
    await promise
  })

  it('issues independent credentials for repeated profiles and starts each credential once', async () => {
    const parent = fakeSession('parent')
    const { host, sessions, createSession } = fakeHost(parent)
    const grants = await approveLaunches(parent, host, 2)

    expect(grants).toHaveLength(2)
    expect(grants[0].credential).not.toBe(grants[1].credential)

    const first = resultJson(await startSessionAgent('parent', grants[0].credential, host))
    const repeated = resultJson(await startSessionAgent('parent', grants[0].credential, host))
    const second = resultJson(await startSessionAgent('parent', grants[1].credential, host))

    expect(first).toMatchObject({ status: 'started', reused: false })
    expect(repeated).toMatchObject({ status: 'started', sessionId: first.sessionId, reused: true })
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(createSession).toHaveBeenCalledTimes(2)
    expect(createSession.mock.calls[0][0].systemPromptAppend).toContain(grants[0].credential)
    expect(getSessionCollaborationSystemPrompt(first.sessionId)).toContain(grants[0].credential)
    expect(sessions.get(first.sessionId)?.send).toHaveBeenCalledWith(expect.objectContaining({ content: 'Task 0' }))
  })

  it('returns session_start when the child begins replying without waiting for the full turn', async () => {
    const parent = fakeSession('parent')
    const sessions = new Map<string, Session>([[parent.id, parent]])
    type ControllableChild = Session & {
      emitEvent: (event: AgentEvent) => void
      finishSend: () => void
    }
    const createSession = vi.fn((options: SessionCreateOptions) => {
      const listeners = new Set<(event: AgentEvent) => void>()
      let resolveSend!: () => void
      const sendDone = new Promise<void>((resolve) => { resolveSend = resolve })
      const child = {
        id: options.id!,
        projectPath: TEST_CWD,
        cwd: TEST_CWD,
        snapshot: { id: options.id!, providerId: 'claude-base', harnessId: 'claude', status: 'idle' } as never,
        emitHostEvent: vi.fn(),
        send: vi.fn(() => sendDone),
        setTitle: vi.fn(),
        isStreaming: vi.fn(() => false),
        injectTaskNotification: vi.fn(async () => {}),
        appendTranscriptMessage: vi.fn(),
        on: vi.fn((handler: (event: AgentEvent) => void) => {
          listeners.add(handler)
          return () => { listeners.delete(handler) }
        }),
        emitEvent: (event: AgentEvent) => {
          for (const handler of listeners) handler(event)
        },
        finishSend: () => resolveSend(),
      } as unknown as ControllableChild
      sessions.set(child.id, child)
      return child
    })
    let activeId: string | null = parent.id
    const host = {
      getSession: (id: string) => sessions.get(id) ?? null,
      getActiveSession: () => (activeId ? sessions.get(activeId) ?? null : null),
      setActiveSession: (_projectPath: string, sessionId: string) => {
        if (!sessions.has(sessionId)) throw new Error(`Session not found: ${sessionId}`)
        activeId = sessionId
      },
      createSession: (options: SessionCreateOptions) => {
        const child = createSession(options)
        activeId = child.id
        return child
      },
      disposeSession: vi.fn(async (id: string) => { sessions.delete(id) }),
      resumeSession: vi.fn((id: string) => {
        const existing = sessions.get(id)
        if (existing) return existing
        throw new Error(`Session ${id} not found`)
      }),
    } as unknown as SessionManager

    const [grant] = await approveLaunches(parent, host)
    const startPromise = startSessionAgent('parent', grant.credential, host)

    await vi.waitFor(() => {
      const child = [...sessions.values()].find((s) => s.id !== 'parent') as ControllableChild | undefined
      expect(child?.send).toHaveBeenCalled()
    })
    const child = [...sessions.values()].find((s) => s.id !== 'parent') as ControllableChild
    child.emitEvent({
      type: 'message_start',
      message: {
        id: 'asst-1',
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: new Date().toISOString(),
        providerId: 'local',
      },
    })

    const started = resultJson(await startPromise)
    expect(started).toMatchObject({ status: 'started', reused: false })
    // Full turn still in flight — session_start must not wait for it.
    expect(child.send).toHaveBeenCalledTimes(1)
    child.finishSend()
    await expect(child.send.mock.results[0].value).resolves.toBeUndefined()
  })

  it('delivers retry-safe bidirectional mailbox messages with endpoint cursors', async () => {
    const parent = fakeSession('parent')
    const { host, sessions } = fakeHost(parent)
    const [grant] = await approveLaunches(parent, host)
    const started = resultJson(await startSessionAgent('parent', grant.credential, host))
    const childId = started.sessionId as string

    const sent = resultJson(await sendSessionMessage('parent', {
      credential: grant.credential,
      content: 'from parent',
      clientMessageId: 'parent-1',
    }, host))
    const retried = resultJson(await sendSessionMessage('parent', {
      credential: grant.credential,
      content: 'from parent',
      clientMessageId: 'parent-1',
    }, host))
    expect(retried).toMatchObject({ messageId: sent.messageId, reused: true })
    expect(sessions.get(childId)?.injectTaskNotification).toHaveBeenCalledTimes(1)

    const childInbox = resultJson(await waitForSessionMessages(childId, {
      credentials: [grant.credential],
      timeoutMs: 0,
    }))
    expect(childInbox.messages).toMatchObject([{ credential: grant.credential, content: 'from parent' }])
    expect(childInbox.peers).toMatchObject([{
      credential: grant.credential,
      name: 'Parent',
      title: 'Parent',
      sessionId: 'parent',
    }])
    expect(resultJson(await waitForSessionMessages(childId, {
      credentials: [grant.credential], timeoutMs: 0,
    }))).toMatchObject({ status: 'timeout', messages: [] })

    await sendSessionMessage(childId, { credential: grant.credential, content: 'from child' }, host)
    const parentInbox = resultJson(await waitForSessionMessages('parent', {
      credentials: [grant.credential], timeoutMs: 0,
    }))
    expect(parentInbox.messages).toMatchObject([{ credential: grant.credential, content: 'from child' }])
    expect(parentInbox.peers).toMatchObject([{
      credential: grant.credential,
      sessionId: childId,
    }])
  })

  it('waits for messages from multiple child sessions without sequential blocking', async () => {
    const parent = fakeSession('parent')
    const { host } = fakeHost(parent)
    const grants = await approveLaunches(parent, host, 2)
    const first = resultJson(await startSessionAgent('parent', grants[0].credential, host))
    const second = resultJson(await startSessionAgent('parent', grants[1].credential, host))

    await sendSessionMessage(first.sessionId, { credential: grants[0].credential, content: 'first' }, host)
    await sendSessionMessage(second.sessionId, { credential: grants[1].credential, content: 'second' }, host)
    const inbox = resultJson(await waitForSessionMessages('parent', {
      credentials: [grants[0].credential, grants[1].credential],
      timeoutMs: 0,
    }))

    expect(inbox.messages).toHaveLength(2)
    expect(inbox.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ credential: grants[0].credential, content: 'first' }),
      expect.objectContaining({ credential: grants[1].credential, content: 'second' }),
    ]))
  })

  it('rejects collaboration calls while the experiment is disabled', async () => {
    state.enabled = false
    const parent = fakeSession('parent')
    const { host } = fakeHost(parent)
    await expect(requestSessionAgents('parent', { launches: [] }, host)).rejects.toThrow(/disabled/i)
  })

  it('requires non-empty names and roles before requesting approval', async () => {
    const parent = fakeSession('parent')
    const { host } = fakeHost(parent)
    const base = { agentId: 'claude-base', task: 'Review the change' }

    await expect(requestSessionAgents(parent.id, {
      launches: [{ ...base, name: '', role: 'Reviewer' }],
    }, host)).rejects.toThrow(/non-empty name/)
    await expect(requestSessionAgents(parent.id, {
      launches: [{ ...base, name: 'Alice', role: '   ' }],
    }, host)).rejects.toThrow(/non-empty role/)
    expect(parent.emitHostEvent).not.toHaveBeenCalled()
  })

  it('merges only editable confirm fields and ignores tampered agentId/task/cwd', async () => {
    const parent = fakeSession('parent')
    const { host, createSession } = fakeHost(parent)
    const promise = requestSessionAgents(parent.id, {
      launches: [{
        launchId: 'launch-0',
        agentId: 'claude-base',
        task: 'Original task',
        name: 'Original',
        role: 'Worker',
        config: { cwd: TEST_CWD, model: 'test-model', permissionMode: 'default', sandboxMode: 'off' },
      }],
    }, host)
    const event = (parent.emitHostEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as AgentEvent
    if (event.type !== 'permission_request') throw new Error('Expected permission request')
    resolveSessionAgentsConfirm(event.request.requestId, 'accept', {
      [SESSION_AGENT_LAUNCHES_FIELD]: JSON.stringify([{
        launchId: 'launch-0',
        agentId: 'tampered-agent',
        task: 'Hijacked task',
        config: {
          cwd: '/tmp/evil',
          model: 'other-model',
          permissionMode: 'bypassPermissions',
          sandboxMode: 'on',
          worktree: { enabled: true, baseBranch: 'main', mode: 'branch' },
        },
      }]),
    })
    const grants = resultJson(await promise).launches as Array<{ credential: string }>
    await startSessionAgent('parent', grants[0].credential, host)
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      model: 'other-model',
      permissionMode: 'bypassPermissions',
      sandboxMode: 'on',
      providerId: 'claude-base',
      cwd: TEST_CWD,
    }))
    const child = createSession.mock.results[0]?.value as Session
    expect(child.send).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Original task',
      source: 'collaboration',
      collaboration: expect.objectContaining({ kind: 'initial_task' }),
    }))
  })

  it('wakes the recipient even while streaming without duplicating collab transcript bubbles', async () => {
    const parent = fakeSession('parent')
    const { host, sessions } = fakeHost(parent)
    const [grant] = await approveLaunches(parent, host)
    const started = resultJson(await startSessionAgent('parent', grant.credential, host))
    const childId = started.sessionId as string
    const child = sessions.get(childId)!
    ;(child.isStreaming as ReturnType<typeof vi.fn>).mockReturnValue(true)

    await sendSessionMessage('parent', {
      credential: grant.credential,
      content: 'wake while busy',
      clientMessageId: 'wake-1',
    }, host)

    expect(child.injectTaskNotification).toHaveBeenCalledTimes(1)
    // Mailbox content is shown via tool UI only — no collab transcript bubbles.
    expect(child.appendTranscriptMessage).not.toHaveBeenCalled()
    expect(parent.appendTranscriptMessage).not.toHaveBeenCalled()
  })

  it('restores the parent as the project active session after starting a child', async () => {
    const parent = fakeSession('parent')
    const { host } = fakeHost(parent)
    const [grant] = await approveLaunches(parent, host)
    expect(host.getActiveSession(TEST_CWD)?.id).toBe('parent')
    const started = resultJson(await startSessionAgent('parent', grant.credential, host))
    expect(started.status).toBe('started')
    // Child create temporarily becomes active, then parent is restored.
    expect(host.getActiveSession(TEST_CWD)?.id).toBe('parent')
  })

  it('restores an empty project active state after starting a child', async () => {
    const parent = fakeSession('parent')
    const { host } = fakeHost(parent, { activeSessionId: null })
    const [grant] = await approveLaunches(parent, host)
    expect(host.getActiveSession(TEST_CWD)).toBeNull()

    const started = resultJson(await startSessionAgent('parent', grant.credential, host))

    expect(started.status).toBe('started')
    expect(host.getActiveSession(TEST_CWD)).toBeNull()
  })

  it('rejects nested collaboration requests from an existing child session', async () => {
    const parent = fakeSession('parent')
    const { host } = fakeHost(parent)
    const [grant] = await approveLaunches(parent, host)
    const started = resultJson(await startSessionAgent('parent', grant.credential, host))
    const childId = started.sessionId as string
    const nested = resultJson(await requestSessionAgents(childId, {
      launches: [{ agentId: 'claude-base', task: 'Nested task', name: 'Nested', role: 'Worker' }],
    }, host))
    expect(nested).toMatchObject({ status: 'error' })
    expect(String(nested.message)).toMatch(/nested/i)
  })

  it('titles child sessions as Name - Role using agent-chosen name', async () => {
    const parent = fakeSession('parent')
    const { host, createSession } = fakeHost(parent)
    const promise = requestSessionAgents(parent.id, {
      launches: [{
        launchId: 'reviewer',
        agentId: 'claude-base',
        task: 'Review the diff carefully',
        name: 'Alice',
        role: 'Reviewer',
        config: { cwd: TEST_CWD, model: 'test-model' },
      }],
    }, host)
    const event = (parent.emitHostEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as AgentEvent
    if (event.type !== 'permission_request') throw new Error('Expected permission request')
    const launches = event.request.sessionAgentsConfirm!.launches
    resolveSessionAgentsConfirm(event.request.requestId, 'accept', {
      [SESSION_AGENT_LAUNCHES_FIELD]: JSON.stringify(launches),
    })
    const grants = resultJson(await promise).launches as Array<{ credential: string; name: string; role: string }>
    expect(grants[0]).toMatchObject({ name: 'Alice', role: 'Reviewer' })
    await startSessionAgent('parent', grants[0].credential, host)
    const child = createSession.mock.results[0]?.value as Session
    expect(child.setTitle).toHaveBeenCalledWith('Alice - Reviewer', 'agent')
  })

  it('returns a tool error for invalid wait credentials instead of throwing', async () => {
    const parent = fakeSession('parent')
    const result = resultJson(await waitForSessionMessages(parent.id, {
      credentials: ['not-a-real-credential'],
      timeoutMs: 0,
    }))
    expect(result).toMatchObject({ status: 'error' })
    expect(String(result.message)).toMatch(/invalid/i)
  })
})
