import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_AGENT_LAUNCHES_FIELD, type AgentEvent } from '@superone/shared/agent-types'
import type { Session, SessionCreateOptions, SessionManager } from './types'

const TEST_CWD = process.cwd()

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  enabled: true,
  activateWorktree: vi.fn(),
  /** path → main checkout; default: identity (cwd is not a worktree). */
  mainWorktreeByPath: new Map<string, string>(),
  resolveMainWorktreeDir: vi.fn(async (folderPath: string) => {
    return state.mainWorktreeByPath.get(folderPath) ?? folderPath
  }),
  resourceCache: {
    claude: {
      models: [{ id: 'test-model', name: 'Test Model', supportedEffortLevels: ['low', 'high'] }],
    },
  } as Record<string, unknown>,
  providers: [{
    id: 'claude-base', harnessId: 'claude', name: 'Claude', isBase: true, config: {}, createdAt: 0, updatedAt: 0,
  }],
  credentials: [{ id: 'api-1', name: 'Seed-lei', platformId: 'openai', planId: 'api' }],
  platforms: [{
    id: 'openai',
    name: 'OpenAI',
    brand: 'openai',
    plans: [{
      id: 'api',
      name: 'API',
      auth: 'api-key',
      endpoints: [{ id: 'openai', baseUrl: 'https://api.openai.com/v1', protocols: ['openai-chat'] }],
    }],
  }],
  projects: [] as Array<{ path: string; missing?: boolean }>,
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
vi.mock('./session-provider-repo', () => ({
  listSessionProviders: () => state.providers,
}))
vi.mock('../git/worktree-ops', () => ({
  activateWorktree: state.activateWorktree,
  resolveMainWorktreeDir: (folderPath: string) => state.resolveMainWorktreeDir(folderPath),
}))
vi.mock('../db-sessions', () => ({
  createSession: (
    projectPath: string,
    sessionId: string,
    title?: string,
    isWorktree?: boolean,
    _gitBranch?: string,
    worktreePath?: string,
  ) => {
    // Mirrors the real guard: a session can only be filed under a known project.
    if (!state.projects.some((project) => project.path === projectPath)) {
      throw new Error(`Project not found for path: ${projectPath}`)
    }
    state.db!.prepare(
      'INSERT INTO sessions (id, project_path, title, is_worktree, worktree_path) VALUES (?, ?, ?, ?, ?)',
    ).run(sessionId, projectPath, title ?? null, isWorktree ? 1 : 0, worktreePath ?? null)
    return sessionId
  },
}))
vi.mock('../recent-folders', () => ({
  getRecentFolders: () => state.projects,
  // Mirrors the real upsert, so a registered folder immediately satisfies the
  // "project must exist" guard in createSession above.
  addRecentFolder: (path: string) => {
    if (!state.projects.some((project) => project.path === path)) state.projects.push({ path })
  },
}))

import {
  requestSessionAgents,
  listSessionAgentProfiles,
  getSessionCollaborationSystemPrompt,
  sendSessionMessage,
  startSessionAgent,
  retrieveSessionMessages,
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
      acp_agent_id TEXT,
      is_worktree INTEGER DEFAULT 0,
      worktree_path TEXT
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

function fakeSession(
  id: string,
  eventsOrOpts: AgentEvent[] | { events?: AgentEvent[]; cwd?: string; projectPath?: string } = [],
): Session {
  const opts = Array.isArray(eventsOrOpts) ? { events: eventsOrOpts } : eventsOrOpts
  const events = opts.events ?? []
  const listeners = new Set<(event: AgentEvent) => void>()
  return {
    id,
    projectPath: opts.projectPath ?? TEST_CWD,
    cwd: opts.cwd ?? TEST_CWD,
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
  // Active session is per project in the real manager — a child attributed to
  // another project must not disturb the parent project's routing, and vice versa.
  const activeByProject = new Map<string, string>()
  const initialActive = options.activeSessionId === undefined ? parent.id : options.activeSessionId
  if (initialActive) activeByProject.set(parent.projectPath, initialActive)
  const host = {
    getSession: (id: string) => sessions.get(id) ?? null,
    getActiveSession: (projectPath: string) => {
      const activeId = activeByProject.get(projectPath)
      return activeId ? sessions.get(activeId) ?? null : null
    },
    setActiveSession: (projectPath: string, sessionId: string) => {
      if (!sessions.has(sessionId)) throw new Error(`Session not found: ${sessionId}`)
      activeByProject.set(projectPath, sessionId)
    },
    clearActiveSession: (projectPath: string) => {
      activeByProject.delete(projectPath)
    },
    createSession: vi.fn((options: SessionCreateOptions) => {
      const child = createSession(options)
      activeByProject.set(options.projectPath, child.id)
      return child
    }),
    disposeSession: vi.fn(async (id: string) => { sessions.delete(id) }),
    resumeSession: vi.fn((id: string) => {
      const existing = sessions.get(id)
      if (existing) return existing
      throw new Error(`Session ${id} not found`)
    }),
  } as unknown as SessionManager
  return {
    host,
    sessions,
    createSession: host.createSession as ReturnType<typeof vi.fn>,
    activeIn: (projectPath: string) => activeByProject.get(projectPath) ?? null,
  }
}

async function approveLaunches(
  parent: Session,
  host: SessionManager,
  count = 1,
  configPatch: Record<string, unknown> = {},
) {
  const promise = requestSessionAgents(parent.id, {
    launches: Array.from({ length: count }, (_, index) => ({
      launchId: `launch-${index}`,
      agentId: 'claude-base',
      task: `Task ${index}`,
      name: `Agent ${index}`,
      role: 'Worker',
      config: { cwd: TEST_CWD, model: 'test-model', effort: 'high', ...configPatch },
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
  state.mainWorktreeByPath.clear()
  state.resolveMainWorktreeDir.mockClear()
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
  state.credentials = [{ id: 'api-1', name: 'Seed-lei', platformId: 'openai', planId: 'api' }]
  state.platforms = [{
    id: 'openai',
    name: 'OpenAI',
    brand: 'openai',
    plans: [{
      id: 'api',
      name: 'API',
      auth: 'api-key',
      endpoints: [{ id: 'openai', baseUrl: 'https://api.openai.com/v1', protocols: ['openai-chat'] }],
    }],
  }]
  state.projects = [{ path: TEST_CWD }]
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

    const childInbox = resultJson(await retrieveSessionMessages(childId, {
      credentials: [grant.credential],
    }))
    expect(childInbox.messages).toMatchObject([{ credential: grant.credential, content: 'from parent' }])
    expect(childInbox.peers).toMatchObject([{
      credential: grant.credential,
      name: 'Parent',
      title: 'Parent',
      sessionId: 'parent',
    }])
    const drained = resultJson(await retrieveSessionMessages(childId, {
      credentials: [grant.credential],
    }))
    expect(drained).toMatchObject({ status: 'empty', messages: [] })
    // An empty mailbox must talk the agent out of re-polling, not just report nothing.
    expect(drained.hint).toMatch(/do not sleep|end your turn/i)

    await sendSessionMessage(childId, { credential: grant.credential, content: 'from child' }, host)
    const parentInbox = resultJson(await retrieveSessionMessages('parent', {
      credentials: [grant.credential],
    }))
    expect(parentInbox.messages).toMatchObject([{ credential: grant.credential, content: 'from child' }])
    expect(parentInbox.peers).toMatchObject([{
      credential: grant.credential,
      sessionId: childId,
    }])
  })

  it('retrieves messages from multiple child sessions in one call', async () => {
    const parent = fakeSession('parent')
    const { host } = fakeHost(parent)
    const grants = await approveLaunches(parent, host, 2)
    const first = resultJson(await startSessionAgent('parent', grants[0].credential, host))
    const second = resultJson(await startSessionAgent('parent', grants[1].credential, host))

    await sendSessionMessage(first.sessionId, { credential: grants[0].credential, content: 'first' }, host)
    await sendSessionMessage(second.sessionId, { credential: grants[1].credential, content: 'second' }, host)
    const inbox = resultJson(await retrieveSessionMessages('parent', {
      credentials: [grants[0].credential, grants[1].credential],
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

  it('returns a tool error for invalid retrieve credentials instead of throwing', async () => {
    const parent = fakeSession('parent')
    const result = resultJson(await retrieveSessionMessages(parent.id, {
      credentials: ['not-a-real-credential'],
    }))
    expect(result).toMatchObject({ status: 'error' })
    expect(String(result.message)).toMatch(/invalid/i)
  })
})

describe('child session project attribution', () => {
  // Real directories, since resolveCwd stats the path. OTHER_PROJECT sits inside
  // TEST_CWD, so it also covers "the more specific project wins".
  // Real directories outside TEST_CWD — resolveCwd stats the path, and anchoring
  // these to the repo layout would break as soon as vitest runs from another cwd.
  let OTHER_PROJECT: string
  let NESTED_IN_OTHER: string
  beforeEach(() => {
    OTHER_PROJECT = mkdtempSync(join(tmpdir(), 'collab-project-'))
    NESTED_IN_OTHER = join(OTHER_PROJECT, 'packages')
    mkdirSync(NESTED_IN_OTHER)
  })
  afterEach(() => {
    rmSync(OTHER_PROJECT, { recursive: true, force: true })
  })

  async function startChild(
    cwd: string,
    host: SessionManager,
    parent: Session,
    configPatch: Record<string, unknown> = {},
  ) {
    const [launch] = await approveLaunches(parent, host, 1, { cwd, ...configPatch })
    return resultJson(await startSessionAgent('parent', launch.credential, host))
  }

  it('files the child under the project owning its cwd, not the parent project', async () => {
    state.projects = [{ path: TEST_CWD }, { path: OTHER_PROJECT }]
    const parent = fakeSession('parent')
    const { host, createSession } = fakeHost(parent)

    await startChild(OTHER_PROJECT, host, parent)

    expect(createSession.mock.calls[0][0].projectPath).toBe(OTHER_PROJECT)
    const row = state.db!.prepare('SELECT project_path FROM sessions WHERE id != ?').get('parent') as { project_path: string }
    expect(row.project_path).toBe(OTHER_PROJECT)
  })

  it('walks up to the owning project when the cwd is a subdirectory of it', async () => {
    state.projects = [{ path: TEST_CWD }, { path: OTHER_PROJECT }]
    const parent = fakeSession('parent')
    const { host, createSession } = fakeHost(parent)

    await startChild(NESTED_IN_OTHER, host, parent)

    expect(createSession.mock.calls[0][0].projectPath).toBe(OTHER_PROJECT)
    expect(createSession.mock.calls[0][0].cwd).toBe(NESTED_IN_OTHER)
  })

  it('lets the most specific project win when projects are nested', async () => {
    state.projects = [{ path: TEST_CWD }, { path: OTHER_PROJECT }, { path: NESTED_IN_OTHER }]
    const parent = fakeSession('parent')
    const { host, createSession } = fakeHost(parent)

    await startChild(NESTED_IN_OTHER, host, parent)

    expect(createSession.mock.calls[0][0].projectPath).toBe(NESTED_IN_OTHER)
  })

  it('registers a directory no open project owns rather than misfiling it under the parent', async () => {
    state.projects = [{ path: TEST_CWD }]
    const parent = fakeSession('parent')
    const { host, createSession } = fakeHost(parent)

    await startChild(OTHER_PROJECT, host, parent)

    expect(state.projects.map((project) => project.path)).toContain(OTHER_PROJECT)
    expect(createSession.mock.calls[0][0].projectPath).toBe(OTHER_PROJECT)
  })

  it('does not register a directory the parent project already covers', async () => {
    state.projects = [{ path: TEST_CWD }]
    const parent = fakeSession('parent')
    const { host, createSession } = fakeHost(parent)

    await startChild(TEST_CWD, host, parent)

    expect(state.projects).toHaveLength(1)
    expect(createSession.mock.calls[0][0].projectPath).toBe(TEST_CWD)
  })

  it('does not register the worktree path when a launch cuts a worktree', async () => {
    const worktreePath = join(tmpdir(), 'collab-fake-worktree')
    state.projects = [{ path: TEST_CWD }]
    state.activateWorktree.mockResolvedValue({ ok: true, path: worktreePath, recordedBranch: 'feature' })
    const parent = fakeSession('parent')
    const { host, createSession } = fakeHost(parent)

    await startChild(TEST_CWD, host, parent, {
      worktree: { enabled: true, baseBranch: 'main', mode: 'branch', branchName: 'wt' },
    })

    expect(state.projects).toHaveLength(1)
    expect(createSession.mock.calls[0][0].projectPath).toBe(TEST_CWD)
    expect(createSession.mock.calls[0][0].cwd).toBe(worktreePath)
  })

  it('attributes a worktree child by its requested cwd, not the worktree path', async () => {
    const worktreePath = join(tmpdir(), 'collab-fake-worktree')
    state.projects = [{ path: TEST_CWD }, { path: OTHER_PROJECT }]
    state.activateWorktree.mockResolvedValue({ ok: true, path: worktreePath, recordedBranch: 'feature' })
    const parent = fakeSession('parent')
    const { host, createSession } = fakeHost(parent)

    await startChild(OTHER_PROJECT, host, parent, {
      worktree: { enabled: true, baseBranch: 'main', mode: 'branch', branchName: 'wt' },
    })

    // The worktree lives outside every project, but it was cut from OTHER_PROJECT.
    expect(state.activateWorktree).toHaveBeenCalledWith(OTHER_PROJECT, expect.anything())
    expect(createSession.mock.calls[0][0].projectPath).toBe(OTHER_PROJECT)
    expect(createSession.mock.calls[0][0].cwd).toBe(worktreePath)
  })

  it('files a child whose cwd is a git worktree under the main project, not as its own project', async () => {
    // Collab defaults cwd to parent.cwd. When the parent already works in a
    // SuperOne worktree, that path sits outside every project root and used to
    // be registered as a sidebar project (tjdllgg-… style folder names).
    const parentWorktree = mkdtempSync(join(tmpdir(), 'parent-wt-'))
    state.projects = [{ path: TEST_CWD }]
    state.mainWorktreeByPath.set(parentWorktree, TEST_CWD)
    const parent = fakeSession('parent', { cwd: parentWorktree, projectPath: TEST_CWD })
    const { host, createSession } = fakeHost(parent)

    await startChild(parentWorktree, host, parent)

    expect(state.projects).toEqual([{ path: TEST_CWD }])
    expect(createSession.mock.calls[0][0].projectPath).toBe(TEST_CWD)
    expect(createSession.mock.calls[0][0].cwd).toBe(parentWorktree)
    rmSync(parentWorktree, { recursive: true, force: true })
  })

  it('does not register a managed ~/.worktrees path when main-dir lookup fails', async () => {
    const { homedir } = await import('os')
    const managedWt = mkdtempSync(join(homedir(), '.worktrees', 'collab-managed-'))
    state.projects = [{ path: TEST_CWD }]
    // Simulate a stale / unreadable worktree: no main-dir mapping.
    const parent = fakeSession('parent', { cwd: managedWt, projectPath: TEST_CWD })
    const { host, createSession } = fakeHost(parent)

    await startChild(managedWt, host, parent)

    expect(state.projects.map((p) => p.path)).toEqual([TEST_CWD])
    expect(createSession.mock.calls[0][0].projectPath).toBe(TEST_CWD)
    rmSync(managedWt, { recursive: true, force: true })
  })

  it('cuts a child worktree while parent is already in a worktree without registering either', async () => {
    const parentWorktree = mkdtempSync(join(tmpdir(), 'parent-wt-'))
    const childWorktree = join(tmpdir(), 'child-wt-fresh')
    state.projects = [{ path: TEST_CWD }]
    state.mainWorktreeByPath.set(parentWorktree, TEST_CWD)
    state.activateWorktree.mockResolvedValue({ ok: true, path: childWorktree, recordedBranch: 'review' })
    const parent = fakeSession('parent', { cwd: parentWorktree, projectPath: TEST_CWD })
    const { host, createSession } = fakeHost(parent)

    await startChild(parentWorktree, host, parent, {
      worktree: { enabled: true, baseBranch: 'main', mode: 'branch', branchName: 'review-g1' },
    })

    expect(state.projects).toEqual([{ path: TEST_CWD }])
    expect(createSession.mock.calls[0][0].projectPath).toBe(TEST_CWD)
    expect(createSession.mock.calls[0][0].cwd).toBe(childWorktree)
    rmSync(parentWorktree, { recursive: true, force: true })
  })

  it('registers a genuinely new project when the agent points cwd outside every open project', async () => {
    // Agents are allowed to open a separate project (other repo / scratch).
    // Only same-repo worktree leaves must not become projects.
    const otherRepo = mkdtempSync(join(tmpdir(), 'collab-other-repo-'))
    state.projects = [{ path: TEST_CWD }]
    const parent = fakeSession('parent')
    const { host, createSession } = fakeHost(parent)

    await startChild(otherRepo, host, parent)

    expect(state.projects.map((p) => p.path)).toContain(otherRepo)
    expect(createSession.mock.calls[0][0].projectPath).toBe(otherRepo)
    expect(createSession.mock.calls[0][0].cwd).toBe(otherRepo)
    rmSync(otherRepo, { recursive: true, force: true })
  })

  it('registers the main checkout when cwd is a worktree of an unopened repo', async () => {
    // Worktree leaf of a repo not yet in the sidebar → open main, not the leaf.
    const { realpathSync } = await import('fs')
    const mainRepo = mkdtempSync(join(tmpdir(), 'collab-unopened-main-'))
    const leaf = mkdtempSync(join(tmpdir(), 'collab-unopened-wt-'))
    const mainCanon = realpathSync(mainRepo)
    const leafCanon = realpathSync(leaf)
    state.projects = [{ path: TEST_CWD }]
    // Map both raw and resolved keys — resolveCwd normalizes the path.
    state.mainWorktreeByPath.set(leaf, mainRepo)
    state.mainWorktreeByPath.set(leafCanon, mainRepo)
    const parent = fakeSession('parent')
    const { host, createSession } = fakeHost(parent)

    await startChild(leaf, host, parent)

    expect(state.projects.map((p) => p.path)).toContain(mainCanon)
    expect(state.projects.map((p) => p.path)).not.toContain(leaf)
    expect(state.projects.map((p) => p.path)).not.toContain(leafCanon)
    expect(createSession.mock.calls[0][0].projectPath).toBe(mainCanon)
    expect(createSession.mock.calls[0][0].cwd).toBe(leaf)
    rmSync(mainRepo, { recursive: true, force: true })
    rmSync(leaf, { recursive: true, force: true })
  })

  it('registers a new project then cuts a worktree under it', async () => {
    const otherRepo = mkdtempSync(join(tmpdir(), 'collab-new-proj-src-'))
    const childWorktree = join(tmpdir(), 'collab-new-proj-wt')
    state.projects = [{ path: TEST_CWD }]
    state.activateWorktree.mockResolvedValue({ ok: true, path: childWorktree, recordedBranch: 'feat' })
    const parent = fakeSession('parent')
    const { host, createSession } = fakeHost(parent)

    await startChild(otherRepo, host, parent, {
      worktree: { enabled: true, baseBranch: 'main', mode: 'branch', branchName: 'new-proj-wt' },
    })

    expect(state.projects.map((p) => p.path)).toContain(otherRepo)
    expect(createSession.mock.calls[0][0].projectPath).toBe(otherRepo)
    expect(createSession.mock.calls[0][0].cwd).toBe(childWorktree)
    rmSync(otherRepo, { recursive: true, force: true })
  })

  it('does not register when the agent points cwd at an existing managed worktree', async () => {
    // Parent is on the main project; agent (or a prior start result) sets cwd to
    // an existing SuperOne worktree path without worktree.enabled.
    // Real-world pattern (VibeInspo): Reviewer grants use implementer worktree
    // as cwd so they can read that tree — host must file under main, not spawn
    // a sidebar project named like `tjdllgg-735f677`.
    const { homedir } = await import('os')
    const managedRoot = join(homedir(), '.worktrees')
    mkdirSync(managedRoot, { recursive: true })
    const existingWt = mkdtempSync(join(managedRoot, 'agent-cwd-wt-'))
    state.projects = [{ path: TEST_CWD }]
    state.mainWorktreeByPath.set(existingWt, TEST_CWD)
    const parent = fakeSession('parent')
    const { host, createSession } = fakeHost(parent)

    await startChild(existingWt, host, parent)

    expect(state.projects.map((p) => p.path)).toEqual([TEST_CWD])
    expect(createSession.mock.calls[0][0].projectPath).toBe(TEST_CWD)
    expect(createSession.mock.calls[0][0].cwd).toBe(existingWt)
    // DB row: project = main, is_worktree + worktree_path even without worktree.enabled
    const row = state.db!.prepare(
      'SELECT project_path, is_worktree, worktree_path FROM sessions WHERE id != ?',
    ).get('parent') as { project_path: string; is_worktree: number; worktree_path: string | null }
    expect(row.project_path).toBe(TEST_CWD)
    expect(row.is_worktree).toBe(1)
    expect(row.worktree_path).toBe(existingWt)
    rmSync(existingWt, { recursive: true, force: true })
  })

  it('restores the active session of the project it actually joined', async () => {
    state.projects = [{ path: TEST_CWD }, { path: OTHER_PROJECT }]
    const parent = fakeSession('parent')
    const { host, activeIn, sessions } = fakeHost(parent)
    // Another session already owns routing in the project the child will join.
    const incumbent = fakeSession('incumbent')
    sessions.set('incumbent', incumbent)
    host.setActiveSession(OTHER_PROJECT, 'incumbent')

    await startChild(OTHER_PROJECT, host, parent)

    expect(activeIn(OTHER_PROJECT)).toBe('incumbent')
    expect(activeIn(TEST_CWD)).toBe('parent')
  })
})
