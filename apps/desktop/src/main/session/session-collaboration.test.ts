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
  /** Harness catalog rows — the gate for which profiles are offered at all. */
  harnessStatuses: {
    claude: { enabled: true, state: 'ready' },
    codex: { enabled: true, state: 'ready' },
    'acp-grok': { enabled: true, state: 'ready' },
    opencode: { enabled: true, state: 'ready' },
    cursor: { enabled: true, state: 'ready' },
    dsh: { enabled: true, state: 'ready' },
  } as Record<string, { enabled: boolean; state: string }>,
  probeHarness: vi.fn((id: string) => {
    const row = state.harnessStatuses[id]
    if (row?.state === 'needs_auth') row.state = 'ready'
  }),
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
    codex: { defaultModel: '', defaultReasoningEffort: '', defaultFastMode: false },
    acp: { selectedAgentId: null as string | null },
  },
}))

vi.mock('../app-settings-service', () => ({
  readAppSettings: () => ({
    // Credential fixture uses openai-chat; Claude needs the bridge flag to list it.
    experimentalClaudeOpenAiChatEnabled: true,
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
vi.mock('../harness/service', () => ({
  getHarnessInstallation: (id: string) => ({
    id,
    ...(state.harnessStatuses[id] ?? { enabled: false, state: 'disabled' }),
  }),
  probeDesktopHarness: state.probeHarness,
}))
vi.mock('../git/worktree-ops', () => ({
  activateWorktree: state.activateWorktree,
  resolveMainWorktreeDir: (folderPath: string) => state.resolveMainWorktreeDir(folderPath),
}))
function ensureProjectId(projectPath: string): string {
  const existing = state.db!.prepare('SELECT id FROM projects WHERE path = ?').get(projectPath) as
    | { id: string }
    | undefined
  if (existing) return existing.id
  const id = `proj-${Buffer.from(projectPath).toString('base64url').slice(0, 24)}`
  state.db!.prepare('INSERT INTO projects (id, path) VALUES (?, ?)').run(id, projectPath)
  return id
}

function insertSessionRow(
  id: string,
  projectPath: string,
  title: string | null,
  extras: {
    providerId?: string | null
    isWorktree?: boolean
    worktreePath?: string | null
  } = {},
): void {
  const projectId = ensureProjectId(projectPath)
  state.db!.prepare(`
    INSERT INTO sessions (id, project_id, title, provider_id, is_worktree, worktree_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    projectId,
    title,
    extras.providerId ?? null,
    extras.isWorktree ? 1 : 0,
    extras.worktreePath ?? null,
  )
}

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
    insertSessionRow(sessionId, projectPath, title ?? null, {
      isWorktree,
      worktreePath: worktreePath ?? null,
    })
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

import { listAgentMentionTargets } from './agent-profiles'
import {
  requestSessionAgents,
  listSessionAgentProfiles,
  getSessionCollaborationRunConfig,
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
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
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
      started_at TEXT,
      kind TEXT NOT NULL DEFAULT 'spawn'
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
  insertSessionRow('parent', TEST_CWD, 'Parent', { providerId: 'claude-base' })
  state.activateWorktree.mockReset()
  state.mainWorktreeByPath.clear()
  state.resolveMainWorktreeDir.mockClear()
  state.probeHarness.mockClear()
  for (const id of ['claude', 'codex', 'acp-grok', 'opencode', 'cursor', 'dsh']) {
    state.harnessStatuses[id] = { enabled: true, state: 'ready' }
  }
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
    codex: { defaultModel: '', defaultReasoningEffort: '', defaultFastMode: false },
    acp: { selectedAgentId: null },
  }
})

describe('session collaboration', () => {
  it('offers a harness the user just enabled but has never opened a session with', () => {
    state.db!.prepare('UPDATE sessions SET provider_id = NULL').run()
    expect(listSessionAgentProfiles()).toHaveLength(1)
  })

  it('offers a harness whose model catalog has not been fetched yet', () => {
    state.resourceCache = {}
    expect(listSessionAgentProfiles()).toEqual([
      expect.objectContaining({ id: 'claude-base', models: [], defaultConfig: {} }),
    ])
  })

  it('omits a harness that is disabled or not installed', () => {
    state.harnessStatuses.claude = { enabled: false, state: 'disabled' }
    expect(listSessionAgentProfiles()).toEqual([])
    state.harnessStatuses.claude = { enabled: true, state: 'missing' }
    expect(listSessionAgentProfiles()).toEqual([])
  })

  it('re-probes a stale needs_auth row instead of hiding a harness the user just signed into', () => {
    state.harnessStatuses.claude = { enabled: true, state: 'needs_auth' }
    expect(listSessionAgentProfiles()).toHaveLength(1)
    expect(state.probeHarness).toHaveBeenCalledWith('claude')
  })
})

describe('@agent mention targets', () => {
  it('gives a base provider the brand keyword rather than its "(Base)" row name', () => {
    state.providers = [{
      id: 'codex-base', harnessId: 'codex', name: 'Codex (Base)', isBase: true, config: {}, createdAt: 0, updatedAt: 0,
    }]
    expect(listAgentMentionTargets()).toEqual([
      expect.objectContaining({
        ref: 'codex-base',
        providerId: 'codex-base',
        slug: 'codex',
        displayName: 'Codex',
        brandKey: 'codex',
        isBase: true,
      }),
    ])
  })

  it('resolves the ACP base provider to the agent behind it', () => {
    state.providers = [{
      id: 'acp-base', harnessId: 'acp', name: 'Others (ACP)', isBase: true,
      config: { agentId: 'grok-build' }, createdAt: 0, updatedAt: 0,
    }]
    expect(listAgentMentionTargets()).toEqual([
      expect.objectContaining({
        ref: 'acp-base:grok-build',
        providerId: 'acp-base',
        acpAgentId: 'grok-build',
        slug: 'grok',
        displayName: 'Grok',
        brandKey: 'acp-grok',
      }),
    ])
  })

  it('never offers an agent that session_collab_request would reject', () => {
    state.harnessStatuses.claude = { enabled: false, state: 'disabled' }
    expect(listAgentMentionTargets()).toEqual([])
    expect(listSessionAgentProfiles()).toEqual([])
  })

  // Forward-looking: user-defined run configurations are just extra provider rows.
  it('names a custom run configuration after itself and keeps the plain keyword on the base row', () => {
    state.providers = [
      { id: 'codex-base', harnessId: 'codex', name: 'Codex (Base)', isBase: true, config: {}, createdAt: 0, updatedAt: 0 },
      { id: 'codex-7f3a', harnessId: 'codex', name: 'Codex', isBase: false, config: {}, createdAt: 1, updatedAt: 1 },
      { id: 'codex-9b2c', harnessId: 'codex', name: 'High Effort Codex', isBase: false, config: {}, createdAt: 2, updatedAt: 2 },
    ]
    expect(listAgentMentionTargets().map((t) => [t.providerId, t.slug, t.displayName])).toEqual([
      ['codex-base', 'codex', 'Codex'],
      ['codex-7f3a', 'codex-2', 'Codex'],
      ['codex-9b2c', 'high-effort-codex', 'High Effort Codex'],
    ])
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
          {
            id: 'gpt-5.6-sol',
            name: 'gpt-5.6-sol',
            supportedReasoningEfforts: [{ value: 'medium' }],
            serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Lower latency' }],
          },
          { id: 'custom-model', name: 'My Custom Model', supportedReasoningEfforts: [{ value: 'high' }] },
        ],
      },
    }
    state.agentPreference = {
      ...state.agentPreference,
      codex: { defaultModel: 'gpt-5.6-sol', defaultReasoningEffort: 'medium', defaultFastMode: true },
    }

    expect(listSessionAgentProfiles()).toEqual([
      expect.objectContaining({
        id: 'codex-base',
        defaultConfig: { model: 'gpt-5.6-sol', effort: 'medium', fastMode: true },
        models: [
          expect.objectContaining({
            id: 'gpt-5.6-sol',
            name: 'GPT5.6 Sol',
            serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Lower latency' }],
          }),
          expect.objectContaining({ id: 'custom-model', name: 'My Custom Model' }),
        ],
      }),
    ])
  })

  it('reads the Cursor catalog for a Cursor profile instead of the OpenCode one', () => {
    state.db!.prepare('UPDATE sessions SET provider_id = ?').run('cursor-base')
    state.providers = [{
      id: 'cursor-base', harnessId: 'cursor', name: 'Cursor', isBase: true, config: {}, createdAt: 0, updatedAt: 0,
    }]
    state.resourceCache = {
      opencode: { models: [{ id: 'anthropic/wrong', name: 'Wrong Harness Model' }] },
      cursor: {
        models: [
          { id: 'composer-1', name: 'Composer 1', supportedEffortLevels: ['low', 'medium'] },
          { id: 'gpt-5', name: 'GPT-5', isDefault: true, supportedEffortLevels: ['medium', 'high'] },
          { id: 'retired', name: 'Retired' },
        ],
        disabledModelIds: ['retired'],
      },
    }

    expect(listSessionAgentProfiles()).toEqual([
      expect.objectContaining({
        id: 'cursor-base',
        models: [
          expect.objectContaining({ id: 'composer-1', name: 'Composer 1' }),
          expect.objectContaining({ id: 'gpt-5', name: 'GPT-5' }),
        ],
        defaultConfig: { model: 'gpt-5', effort: 'medium' },
      }),
    ])
  })

  it('reads the dsh catalog for a DeepSeek profile', () => {
    state.db!.prepare('UPDATE sessions SET provider_id = ?').run('dsh-base')
    state.providers = [{
      id: 'dsh-base', harnessId: 'dsh', name: 'DeepSeek', isBase: true, config: {}, createdAt: 0, updatedAt: 0,
    }]
    state.resourceCache = {
      dsh: {
        models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', supportedEffortLevels: ['medium', 'high'] }],
      },
    }

    expect(listSessionAgentProfiles()).toEqual([
      expect.objectContaining({
        id: 'dsh-base',
        models: [expect.objectContaining({ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' })],
        defaultConfig: { model: 'deepseek-v4-pro', effort: 'medium' },
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

  it('applies approved Codex Fast Mode to the child session and resume config', async () => {
    state.db!.prepare('UPDATE sessions SET provider_id = ?').run('codex-base')
    state.providers = [{
      id: 'codex-base', harnessId: 'codex', name: 'Codex', isBase: true, config: {}, createdAt: 0, updatedAt: 0,
    }]
    state.resourceCache = {
      codex: {
        models: [{
          id: 'gpt-5.6-sol',
          name: 'gpt-5.6-sol',
          supportedReasoningEfforts: [{ value: 'medium' }],
          serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Lower latency' }],
        }],
      },
    }
    state.agentPreference = {
      ...state.agentPreference,
      codex: { defaultModel: 'gpt-5.6-sol', defaultReasoningEffort: 'medium', defaultFastMode: true },
    }
    const parent = fakeSession('parent')
    const { host, createSession } = fakeHost(parent)
    const promise = requestSessionAgents(parent.id, {
      launches: [{
        launchId: 'fast-codex',
        agentId: 'codex-base',
        task: 'Run with Fast Mode',
        name: 'FastBot',
        role: 'Worker',
      }],
    }, host)
    const event = (parent.emitHostEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as AgentEvent
    if (event.type !== 'permission_request') throw new Error('Expected permission request')
    const launches = event.request.sessionAgentsConfirm!.launches
    expect(launches[0].config.fastMode).toBe(true)
    resolveSessionAgentsConfirm(event.request.requestId, 'accept', {
      [SESSION_AGENT_LAUNCHES_FIELD]: JSON.stringify(launches),
    })

    const grants = resultJson(await promise).launches as Array<{ credential: string }>
    const started = resultJson(await startSessionAgent('parent', grants[0].credential, host))

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'codex-base',
      codexServiceTier: 'priority',
    }))
    expect(getSessionCollaborationRunConfig(started.sessionId as string)).toEqual({
      permissionMode: 'default',
      sandboxMode: 'off',
      codexServiceTier: 'priority',
    })
    expect(started.config).toMatchObject({ fastMode: true })
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

  it('dismisses the agent request when the MCP tool call is cancelled', async () => {
    const parent = fakeSession('parent')
    const { host } = fakeHost(parent)
    const controller = new AbortController()
    const promise = requestSessionAgents(parent.id, {
      launches: [{
        launchId: 'cancelled-launch',
        agentId: 'claude-base',
        task: 'This launch should never be approved',
        name: 'Cancelled',
        role: 'Worker',
      }],
    }, host, controller.signal)
    const requestEvent = (parent.emitHostEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as AgentEvent
    if (requestEvent.type !== 'permission_request') throw new Error('Expected permission request')

    controller.abort()

    expect(resultJson(await promise)).toMatchObject({ status: 'cancelled' })
    expect(parent.emitHostEvent).toHaveBeenLastCalledWith({
      type: 'interaction_resolved',
      interactionType: 'permission',
      requestId: requestEvent.request.requestId,
      approved: false,
    })
    expect(resolveSessionAgentsConfirm(requestEvent.request.requestId, 'accept')).toBe(false)
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
    const started = resultJson(await startSessionAgent('parent', grants[0].credential, host))
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      model: 'other-model',
      permissionMode: 'bypassPermissions',
      sandboxMode: 'on',
      providerId: 'claude-base',
      cwd: TEST_CWD,
    }))
    expect(getSessionCollaborationRunConfig(started.sessionId as string)).toEqual({
      permissionMode: 'bypassPermissions',
      sandboxMode: 'on',
    })
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

  function markWorktreeRemoved(sessionId: string): string {
    const worktreePath = join(tmpdir(), `gone-worktree-${sessionId}`)
    state.db!.prepare('UPDATE sessions SET is_worktree = 1, worktree_path = ? WHERE id = ?')
      .run(worktreePath, sessionId)
    return worktreePath
  }

  it('does not wake a spawn child after its worktree directory is removed', async () => {
    const parent = fakeSession('parent')
    const { host, sessions } = fakeHost(parent)
    const [grant] = await approveLaunches(parent, host)
    const started = resultJson(await startSessionAgent('parent', grant.credential, host))
    const childId = started.sessionId as string
    const child = sessions.get(childId)!
    markWorktreeRemoved(childId)
    ;(child.injectTaskNotification as ReturnType<typeof vi.fn>).mockClear()

    const sent = resultJson(await sendSessionMessage('parent', {
      credential: grant.credential,
      content: 'please continue',
      clientMessageId: 'after-wt-gone',
    }, host))

    expect(sent).toMatchObject({ status: 'error' })
    expect(String(sent.message)).toMatch(/worktree directory has been removed/i)
    expect(child.injectTaskNotification).not.toHaveBeenCalled()

    const retrieved = resultJson(await retrieveSessionMessages(childId, {
      credentials: [grant.credential],
    }))
    expect(retrieved.status).toBe('empty')
    expect(retrieved.messages).toEqual([])
  })

  it('does not re-deliver the initial task when restarting a child whose worktree is gone', async () => {
    const parent = fakeSession('parent')
    const { host, sessions } = fakeHost(parent)
    const [grant] = await approveLaunches(parent, host)
    const started = resultJson(await startSessionAgent('parent', grant.credential, host))
    const childId = started.sessionId as string
    const child = sessions.get(childId)!
    markWorktreeRemoved(childId)
    ;(child.send as ReturnType<typeof vi.fn>).mockClear()

    const retry = resultJson(await startSessionAgent('parent', grant.credential, host))
    expect(retry).toMatchObject({ status: 'error' })
    expect(String(retry.message)).toMatch(/worktree directory has been removed/i)
    expect(child.send).not.toHaveBeenCalled()
  })

  it('does not activate a link peer after its worktree directory is removed', async () => {
    insertSessionRow('peer-wt-gone', TEST_CWD, 'Peer WT', {
      providerId: 'claude-base',
      isWorktree: true,
      worktreePath: join(tmpdir(), 'gone-link-worktree'),
    })
    const parent = fakeSession('parent')
    const peer = fakeSession('peer-wt-gone')
    const { host, sessions } = fakeHost(parent)
    sessions.set(peer.id, peer)

    const promise = requestSessionAgents(parent.id, {
      launches: [{
        mode: 'link',
        sessionId: 'peer-wt-gone',
        summary: 'Sync on the existing review',
        task: 'Please confirm the types.',
      }],
    }, host)
    const event = (parent.emitHostEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as AgentEvent
    if (event.type !== 'permission_request') throw new Error('Expected permission request')
    const launches = event.request.sessionAgentsConfirm!.launches
    resolveSessionAgentsConfirm(event.request.requestId, 'accept', {
      [SESSION_AGENT_LAUNCHES_FIELD]: JSON.stringify(launches),
    })
    const approved = resultJson(await promise)
    const grant = (approved.launches as Array<{ credential: string }>)[0]

    const linked = resultJson(await startSessionAgent('parent', grant.credential, host))
    expect(linked).toMatchObject({ status: 'error' })
    expect(String(linked.message)).toMatch(/worktree directory has been removed/i)
    expect(peer.injectTaskNotification).not.toHaveBeenCalled()
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

  it('approves a link launch, activates without system prompt, and exchanges mailbox messages', async () => {
    insertSessionRow('peer-session', TEST_CWD, 'Peer Review', { providerId: 'claude-base' })
    const parent = fakeSession('parent')
    const peer = fakeSession('peer-session')
    const { host, sessions } = fakeHost(parent)
    sessions.set(peer.id, peer)

    const promise = requestSessionAgents(parent.id, {
      launches: [{
        mode: 'link',
        sessionId: 'peer-session',
        summary: 'Sync on API types',
        task: 'Please confirm the request body shape.',
      }],
    }, host)
    const event = (parent.emitHostEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as AgentEvent
    if (event.type !== 'permission_request') throw new Error('Expected permission request')
    const launches = event.request.sessionAgentsConfirm!.launches
    expect(launches[0]).toMatchObject({
      mode: 'link',
      sessionId: 'peer-session',
      peerTitle: 'Peer Review',
    })
    resolveSessionAgentsConfirm(event.request.requestId, 'accept', {
      [SESSION_AGENT_LAUNCHES_FIELD]: JSON.stringify(launches),
    })
    const approved = resultJson(await promise)
    expect(approved.status).toBe('approved')
    const grant = (approved.launches as Array<{ credential: string; mode: string; peerSessionId: string }>)[0]
    expect(grant.mode).toBe('link')
    expect(grant.peerSessionId).toBe('peer-session')

    // Link peers must never receive system-prompt injection.
    expect(getSessionCollaborationSystemPrompt('peer-session')).toBeUndefined()

    const linked = resultJson(await startSessionAgent('parent', grant.credential, host))
    expect(linked).toMatchObject({ status: 'linked', mode: 'link', sessionId: 'peer-session' })
    expect(peer.injectTaskNotification).toHaveBeenCalled()
    // Opening delivered as mailbox, not system prompt.
    expect(getSessionCollaborationSystemPrompt('peer-session')).toBeUndefined()

    const sent = resultJson(await sendSessionMessage('parent', {
      credential: grant.credential,
      content: 'Here is the proposed type.',
    }, host))
    expect(sent.status).toBe('sent')

    const retrieved = resultJson(await retrieveSessionMessages('peer-session', {
      credentials: [grant.credential],
    }))
    expect(retrieved.status).toBe('messages')
    const messages = retrieved.messages as Array<{ content: string }>
    expect(messages.some((m) => m.content.includes('request body') || m.content.includes('proposed type'))).toBe(true)
  })

  it('rejects link without sessionId and self-link', async () => {
    const parent = fakeSession('parent')
    const { host } = fakeHost(parent)
    await expect(requestSessionAgents(parent.id, {
      launches: [{ mode: 'link', summary: 'no id' }],
    }, host)).rejects.toThrow(/sessionId/i)

    await expect(requestSessionAgents(parent.id, {
      launches: [{ mode: 'link', sessionId: 'parent', summary: 'self' }],
    }, host)).rejects.toThrow(/itself/i)
  })

  it('requires start before send on link grants', async () => {
    insertSessionRow('peer-2', TEST_CWD, 'Peer 2', { providerId: 'claude-base' })
    const parent = fakeSession('parent')
    const peer = fakeSession('peer-2')
    const { host, sessions } = fakeHost(parent)
    sessions.set(peer.id, peer)

    const promise = requestSessionAgents(parent.id, {
      launches: [{ mode: 'link', sessionId: 'peer-2', summary: 'hi' }],
    }, host)
    const event = (parent.emitHostEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as AgentEvent
    if (event.type !== 'permission_request') throw new Error('Expected permission request')
    resolveSessionAgentsConfirm(event.request.requestId, 'accept', {
      [SESSION_AGENT_LAUNCHES_FIELD]: JSON.stringify(event.request.sessionAgentsConfirm!.launches),
    })
    const grant = (resultJson(await promise).launches as Array<{ credential: string }>)[0]
    const early = resultJson(await sendSessionMessage('parent', {
      credential: grant.credential,
      content: 'too early',
    }, host))
    expect(early).toMatchObject({ status: 'error' })
    expect(String(early.message)).toMatch(/not been started/i)
  })

  /**
   * Handoff = spawn's launch shape, but the created session is a sibling that owns
   * the task. The three load-bearing differences are asserted here: no credential in
   * the system prompt, no endpoint row (child_session_id stays NULL so every
   * parent→child query and the UNIQUE endpoint slot skip it), and a provenance line
   * in the delivered task since the receiver has no other way to trace the work.
   */
  async function approveHandoff(parent: Session, host: SessionManager) {
    const promise = requestSessionAgents(parent.id, {
      launches: [{
        mode: 'handoff',
        agentId: 'claude-base',
        summary: 'Continue the migration',
        task: 'Finish phase 2 of the migration and run the focused tests.',
        name: 'Dana',
        role: 'Implementer',
        config: { cwd: TEST_CWD, model: 'test-model', effort: 'high', permissionMode: 'bypassPermissions' },
      }],
    }, host)
    const event = (parent.emitHostEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as AgentEvent
    if (event.type !== 'permission_request') throw new Error('Expected permission request')
    const launches = event.request.sessionAgentsConfirm!.launches
    expect(launches[0]).toMatchObject({ mode: 'handoff', agentId: 'claude-base' })
    resolveSessionAgentsConfirm(event.request.requestId, 'accept', {
      [SESSION_AGENT_LAUNCHES_FIELD]: JSON.stringify(launches),
    })
    const approved = resultJson(await promise)
    expect(approved.status).toBe('approved')
    return (approved.launches as Array<{ credential: string; mode: string }>)[0]
  }

  it('hands off to a sibling session with the task but no credential or mailbox', async () => {
    const parent = fakeSession('parent')
    const { host, sessions, createSession } = fakeHost(parent)
    const grant = await approveHandoff(parent, host)
    expect(grant.mode).toBe('handoff')

    const started = resultJson(await startSessionAgent('parent', grant.credential, host))
    expect(started).toMatchObject({ status: 'started', mode: 'handoff', reused: false })
    expect(String(started.note)).toMatch(/sibling/i)

    const sessionId = started.sessionId as string
    // No system-prompt credential injection — the receiver cannot reply at all.
    expect(createSession.mock.calls[0][0].systemPromptAppend).toBeUndefined()
    expect(getSessionCollaborationSystemPrompt(sessionId)).toBeUndefined()
    // Approved permission mode applies at creation...
    expect(createSession.mock.calls[0][0].permissionMode).toBe('bypassPermissions')
    // ...but is not re-pinned on resume: the sibling is the user's session from here on.
    expect(getSessionCollaborationRunConfig(sessionId)).toBeNull()

    // Never an endpoint: the sidebar/archive parent→child joins and the UNIQUE
    // child_session_id slot must both stay free for this session.
    const row = state.db!.prepare(`
      SELECT kind, child_session_id, started_at FROM session_collaboration_grants
      WHERE parent_session_id = 'parent'
    `).get() as { kind: string; child_session_id: string | null; started_at: string | null }
    expect(row.kind).toBe('handoff')
    expect(row.child_session_id).toBeNull()
    expect(row.started_at).toBeTruthy()

    const child = sessions.get(sessionId)!
    const sent = (child.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as { content: string }
    expect(sent.content).toContain('Handed off from SuperOne session `parent`')
    expect(sent.content).toContain('Finish phase 2 of the migration')
  })

  it('refuses mailbox traffic on a handoff credential from either side', async () => {
    const parent = fakeSession('parent')
    const { host } = fakeHost(parent)
    const grant = await approveHandoff(parent, host)
    const started = resultJson(await startSessionAgent('parent', grant.credential, host))
    const sessionId = started.sessionId as string

    const send = resultJson(await sendSessionMessage('parent', {
      credential: grant.credential,
      content: 'any follow-up?',
    }, host))
    expect(send).toMatchObject({ status: 'error' })
    expect(String(send.message)).toMatch(/one-way/i)

    const retrieve = resultJson(await retrieveSessionMessages(sessionId, { credentials: [grant.credential] }))
    expect(retrieve).toMatchObject({ status: 'error' })
    expect(String(retrieve.message)).toMatch(/one-way/i)
  })

  it('is idempotent on retry: same sibling session, task delivered once', async () => {
    const parent = fakeSession('parent')
    const { host, sessions, createSession } = fakeHost(parent)
    const grant = await approveHandoff(parent, host)
    const first = resultJson(await startSessionAgent('parent', grant.credential, host))
    const second = resultJson(await startSessionAgent('parent', grant.credential, host))

    expect(second).toMatchObject({ status: 'started', mode: 'handoff', reused: true })
    expect(second.sessionId).toBe(first.sessionId)
    expect(createSession).toHaveBeenCalledTimes(1)
    const child = sessions.get(first.sessionId as string)!
    expect(child.send).toHaveBeenCalledTimes(1)
  })

  /**
   * A spawn child is FK-linked to its grant (delete cascades the row away, so a retry
   * cannot find the credential at all). A handoff session is not, so this retry path
   * is reachable with a session that no longer exists.
   */
  it('reports a deleted handoff session instead of throwing on retry', async () => {
    const parent = fakeSession('parent')
    const { host, sessions } = fakeHost(parent)
    const grant = await approveHandoff(parent, host)
    const started = resultJson(await startSessionAgent('parent', grant.credential, host))
    const sessionId = started.sessionId as string

    sessions.delete(sessionId)
    state.db!.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)

    const retry = resultJson(await startSessionAgent('parent', grant.credential, host))
    expect(retry).toMatchObject({ status: 'error' })
    expect(String(retry.message)).toMatch(/no longer exists/i)
  })

  it('lets a handoff receiver hand off again — siblings are not nested children', async () => {
    const parent = fakeSession('parent')
    const { host, sessions } = fakeHost(parent)
    const grant = await approveHandoff(parent, host)
    const started = resultJson(await startSessionAgent('parent', grant.credential, host))
    const sibling = sessions.get(started.sessionId as string)!

    const promise = requestSessionAgents(sibling.id, {
      launches: [{
        mode: 'handoff',
        agentId: 'claude-base',
        summary: 'Pass phase 3 on',
        task: 'Run phase 3.',
        name: 'Eli',
        role: 'Implementer',
        config: { cwd: TEST_CWD },
      }],
    }, host)
    const event = (sibling.emitHostEvent as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0] as AgentEvent)
      .find((e) => e.type === 'permission_request')
    if (!event || event.type !== 'permission_request') throw new Error('Expected permission request')
    resolveSessionAgentsConfirm(event.request.requestId, 'decline', {})
    expect(resultJson(await promise).status).toBe('rejected')
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
    const row = state.db!.prepare(`
      SELECT p.path AS project_path
      FROM sessions s JOIN projects p ON p.id = s.project_id
      WHERE s.id != ?
    `).get('parent') as { project_path: string }
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

  it('repro: parent is a worktree session of main — default launch cwd is project root, not the worktree leaf', async () => {
    // Exact packaged-app failure (2026-08-07):
    //   parent project_path = …/Projects/super-one
    //   parent.cwd / worktree_path = …/.worktrees/super-one/tjdnup-b375880
    //   collab request omitted cwd → grant stored parent.cwd → fake project "tjdnup-…"
    const { homedir } = await import('os')
    const { realpathSync } = await import('fs')
    const managedRoot = join(homedir(), '.worktrees', 'super-one-repro')
    mkdirSync(managedRoot, { recursive: true })
    const parentWt = mkdtempSync(join(managedRoot, 'tjdnup-'))
    const parentWtCanon = realpathSync(parentWt)
    state.projects = [{ path: TEST_CWD }]
    state.mainWorktreeByPath.set(parentWt, TEST_CWD)
    state.mainWorktreeByPath.set(parentWtCanon, TEST_CWD)
    const parent = fakeSession('parent', { cwd: parentWt, projectPath: TEST_CWD })
    const { host, createSession } = fakeHost(parent)

    // No config.cwd — exercises defaultLaunchCwd (must NOT copy parent.cwd).
    const promise = requestSessionAgents(parent.id, {
      launches: [{
        launchId: 'repro-default-cwd',
        agentId: 'claude-base',
        task: 'Polish collab copy',
        name: 'CopySmith',
        role: 'Implementer',
        config: { model: 'test-model', effort: 'high' },
      }],
    }, host)
    const event = (parent.emitHostEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as AgentEvent
    if (event.type !== 'permission_request') throw new Error('Expected permission request')
    const proposed = event.request.sessionAgentsConfirm!.launches[0]!
    expect(proposed.config.cwd).toBe(TEST_CWD)
    expect(proposed.config.cwd).not.toBe(parentWt)
    expect(proposed.config.cwd).not.toBe(parentWtCanon)

    resolveSessionAgentsConfirm(event.request.requestId, 'accept', {
      [SESSION_AGENT_LAUNCHES_FIELD]: JSON.stringify(event.request.sessionAgentsConfirm!.launches),
    })
    const grants = resultJson(await promise).launches as Array<{ credential: string }>
    await startSessionAgent('parent', grants[0]!.credential, host)

    expect(state.projects.map((p) => p.path)).toEqual([TEST_CWD])
    expect(createSession.mock.calls[0][0].projectPath).toBe(TEST_CWD)
    expect(createSession.mock.calls[0][0].cwd).toBe(TEST_CWD)
    const row = state.db!.prepare(`
      SELECT p.path AS project_path, s.is_worktree, s.worktree_path
      FROM sessions s JOIN projects p ON p.id = s.project_id
      WHERE s.id != ?
    `).get('parent') as { project_path: string; is_worktree: number; worktree_path: string | null }
    expect(row.project_path).toBe(TEST_CWD)
    // Runtime cwd is project root (no worktree cut) — not a worktree session.
    expect(row.is_worktree).toBe(0)
    expect(row.worktree_path).toBeNull()
    rmSync(parentWt, { recursive: true, force: true })
  })

  it('repro: even if grant cwd is already the parent worktree path, never register it as a project', async () => {
    // Adversarial / old-client grant: config.cwd already points at the worktree leaf.
    // start must still file under main and record worktree_path.
    const { homedir } = await import('os')
    const { realpathSync } = await import('fs')
    const managedRoot = join(homedir(), '.worktrees', 'super-one-repro2')
    mkdirSync(managedRoot, { recursive: true })
    const parentWt = mkdtempSync(join(managedRoot, 'tjdnup-'))
    const parentWtCanon = realpathSync(parentWt)
    state.projects = [{ path: TEST_CWD }]
    state.mainWorktreeByPath.set(parentWt, TEST_CWD)
    state.mainWorktreeByPath.set(parentWtCanon, TEST_CWD)
    const parent = fakeSession('parent', { cwd: parentWt, projectPath: TEST_CWD })
    const { host, createSession } = fakeHost(parent)

    await startChild(parentWt, host, parent)

    expect(state.projects.map((p) => p.path)).toEqual([TEST_CWD])
    expect(createSession.mock.calls[0][0].projectPath).toBe(TEST_CWD)
    expect(createSession.mock.calls[0][0].cwd).toBe(parentWt)
    const row = state.db!.prepare(`
      SELECT p.path AS project_path, s.is_worktree, s.worktree_path
      FROM sessions s JOIN projects p ON p.id = s.project_id
      WHERE s.id != ?
    `).get('parent') as { project_path: string; is_worktree: number; worktree_path: string | null }
    expect(row.project_path).toBe(TEST_CWD)
    expect(row.is_worktree).toBe(1)
    expect(row.worktree_path).toBe(parentWt)
    rmSync(parentWt, { recursive: true, force: true })
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
    const row = state.db!.prepare(`
      SELECT p.path AS project_path, s.is_worktree, s.worktree_path
      FROM sessions s JOIN projects p ON p.id = s.project_id
      WHERE s.id != ?
    `).get('parent') as { project_path: string; is_worktree: number; worktree_path: string | null }
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
