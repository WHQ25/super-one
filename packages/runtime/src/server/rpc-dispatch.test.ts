import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ExecutionEnvironmentDescriptor } from '@superone/shared/environment'
import type { NodeSessionRecord } from '../session/index'
import { dispatchRpc } from './rpc-dispatch'
import { resetSandboxCapabilityCacheForTests } from '../sandbox/index'
import type {
  HostCapabilityFlags,
  ProjectsPort,
  RpcContext,
  RpcHostHooks,
  SessionHostPort,
} from './rpc-context'
import type { NodeIdentity } from './identity'

const flags: HostCapabilityFlags = {
  coldSessionResume: false,
  turnReattach: false,
  hostActionV1: false,
}

const projects = {
  list: () => [{ projectId: 'p1', path: '/tmp/p1', name: 'p1' }],
  get: (projectId: string) => (projectId === 'p1' ? { projectId: 'p1', path: '/tmp/p1', name: 'p1' } : null),
} as unknown as ProjectsPort

/** A host that serves only projects: no sessions, terminals, workspace or git. */
function projectsOnlyHost(over: Partial<RpcContext> = {}): RpcContext {
  return {
    client: {
      clientSessionId: 'c1',
      scopes: ['environment:read', 'project:read', 'session:read', 'session:operate', 'terminal:operate'],
      devicePublicKeyFingerprint: 'fp',
      devicePublicKeyPem: 'pem',
    },
    identity: { environmentId: 'env-1', label: 'B', publicKeyFingerprint: 'fp' } as NodeIdentity,
    idempotency: {
      payloadHash: () => 'h',
      runExclusive: (_c, _o, _k, _h, execute) => execute(),
    },
    leases: {} as RpcContext['leases'],
    settingsConfigPath: '/tmp/none/config.json',
    hooks: {
      isCodexBinaryOverrideRunnable: () => false,
      isClaudeBinaryOverrideRunnable: () => false,
      resolveReleaseVersion: () => '1.0.0',
    } as unknown as RpcHostHooks,
    capabilities: flags,
    startedAt: 0,
    idempotencyKey: 'k1',
    projects,
    ...over,
  }
}

function providersWithAgent(agentId: string): NonNullable<RpcContext['sessionProviders']> {
  return {
    get: () => ({
      id: 'acp-custom',
      harnessId: 'acp',
      name: 'ACP',
      isBase: true,
      config: { agentId },
      createdAt: 0,
      updatedAt: 0,
    }),
  }
}

function sessionRecord(over: Partial<NodeSessionRecord> = {}): NodeSessionRecord {
  return {
    sessionId: 's',
    projectId: 'p1',
    harnessId: 'claude',
    providerId: 'claude',
    title: null,
    status: 'idle',
    transcript: [],
    pendingInteraction: null,
    providerResume: null,
    cwd: null,
    createdAt: 1,
    updatedAt: 2,
    isPinned: false,
    isHidden: false,
    isUserRenamed: false,
    controllerClientSessionId: null,
    hostActionCapabilityVersion: 0,
    hostActionToolGroups: [],
    alwaysAllowedTools: [],
    ...over,
  }
}

describe('session list brand', () => {
  const rows = [
    sessionRecord({ sessionId: 'c', harnessId: 'cursor', providerId: 'cursor-base' }),
    sessionRecord({ sessionId: 'g', harnessId: 'acp', providerId: 'acp-base', acpAgentId: 'grok-build' }),
    sessionRecord({ sessionId: 'a', harnessId: 'acp', providerId: 'acp-base', acpAgentId: null }),
  ]
  const sessions = {
    list: () => rows,
    get: (id: string) => rows.find((row) => row.sessionId === id) ?? null,
  } as unknown as SessionHostPort

  it('lists cursor and only a named ACP agent', async () => {
    const listed = await dispatchRpc('session.list', { projectId: 'p1', limit: 50, offset: 0 }, projectsOnlyHost({ sessions }))
    const result = listed.result as Array<Record<string, unknown>>
    expect(result.find((row) => row.sessionId === 'c')).toMatchObject({ harnessId: 'cursor' })
    expect(result.find((row) => row.sessionId === 'c')).not.toHaveProperty('acpAgentId')
    expect(result.find((row) => row.sessionId === 'g')).toMatchObject({ harnessId: 'acp', acpAgentId: 'grok-build' })
    expect(result.find((row) => row.sessionId === 'a')).not.toHaveProperty('acpAgentId')
  })

  it('returns the session agent, then the provider config, and omits the field when neither exists', async () => {
    const own = await dispatchRpc('session.get', { sessionId: 'g', includeTranscript: false }, projectsOnlyHost({ sessions }))
    expect(own.result).toMatchObject({ acpAgentId: 'grok-build' })
    expect(own.result).not.toHaveProperty('transcript')

    const unnamed = await dispatchRpc('session.get', { sessionId: 'a' }, projectsOnlyHost({ sessions }))
    expect(unnamed.result).not.toHaveProperty('acpAgentId')

    const fromConfig = projectsOnlyHost({
      sessions: { get: () => sessionRecord({ harnessId: 'acp', providerId: 'acp-custom', acpAgentId: null }) } as unknown as SessionHostPort,
      sessionProviders: providersWithAgent('from-config'),
    })
    expect((await dispatchRpc('session.get', { sessionId: 's' }, fromConfig)).result).toMatchObject({ acpAgentId: 'from-config' })

    const recordedWins = projectsOnlyHost({
      sessions: { get: () => sessionRecord({ harnessId: 'acp', acpAgentId: 'custom-agent' }) } as unknown as SessionHostPort,
      sessionProviders: providersWithAgent('grok-build'),
    })
    expect((await dispatchRpc('session.get', { sessionId: 's' }, recordedWins)).result).toMatchObject({ acpAgentId: 'custom-agent' })
  })
})

describe('node rpc dispatch on a partial host', () => {
  it('serves the families whose ports the host provides', async () => {
    const res = await dispatchRpc('project.list', {}, projectsOnlyHost())
    expect(res).toEqual({ result: [{ projectId: 'p1', path: '/tmp/p1', name: 'p1' }] })
  })

  it('answers an unserved family with the explicit unsupported error', async () => {
    for (const method of ['session.get', 'terminal.create', 'workspace.readFile', 'git.status', 'collaboration.send']) {
      const res = await dispatchRpc(method, {}, projectsOnlyHost())
      expect(res.error).toMatchObject({ code: 'not_found', details: { method, unsupported: true } })
    }
  })

  it('keeps unknown methods distinct from unserved ones', async () => {
    const res = await dispatchRpc('nope.method', {}, projectsOnlyHost())
    expect(res.error).toEqual({ code: 'not_found', message: 'unknown method: nope.method' })
  })

  it('advertises only the served families in the descriptor', async () => {
    const res = await dispatchRpc('environment.descriptor', {}, projectsOnlyHost())
    const descriptor = res.result as ExecutionEnvironmentDescriptor
    expect(descriptor.capabilities.harnessIds).toEqual([])
    // Only what its one port serves, and the environment family every host has.
    expect(descriptor.capabilities.methods).toContain('project.list')
    expect(descriptor.capabilities.methods).toContain('environment.descriptor')
    for (const method of ['session.get', 'terminal.create', 'workspace.readFile', 'git.status', 'collaboration.send', 'artifact.put']) {
      expect(descriptor.capabilities.methods).not.toContain(method)
    }
    expect(descriptor.syncRoot).toBeUndefined()
  })

  it('lets host extensions answer before the shared families', async () => {
    const res = await dispatchRpc(
      'session.archive',
      {},
      projectsOnlyHost({
        extensions: (method) => (method === 'session.archive' ? { result: 'from extension' } : null),
      }),
    )
    expect(res).toEqual({ result: 'from extension' })
  })
})

describe('terminal control delegates', () => {
  it('resolves a session worktree and filters its project terminals on the host', async () => {
    const create = vi.fn(input => ({ terminalId: 'new', ...input }))
    const ctx = projectsOnlyHost({
      terminals: { create, list: () => [
        { terminalId: 'root', cwd: '/tmp/p1' }, { terminalId: 'nested', cwd: '/tmp/p1/sub' },
        { terminalId: 'worktree', cwd: '/tmp/worktree' }, { terminalId: 'other', cwd: '/tmp/p11' },
      ] } as unknown as RpcContext['terminals'],
      sessions: { get: () => ({ projectId: 'p1', cwd: '/tmp/worktree' }) } as unknown as SessionHostPort,
    })
    const payload = { projectId: 'p1', sessionId: 's' }
    expect(await dispatchRpc('terminal.create', payload, ctx)).toMatchObject({ result: { cwd: '/tmp/worktree' } })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/tmp/worktree', projectPath: '/tmp/p1' }))
    expect(await dispatchRpc('terminal.list', payload, ctx)).toMatchObject({ result: { terminals: [
      { terminalId: 'root' }, { terminalId: 'nested' }, { terminalId: 'worktree' },
    ] } })
  })

  it('refuses an unknown project or a session outside it before creating a PTY', async () => {
    const create = vi.fn()
    const ctx = projectsOnlyHost({ terminals: { create } as unknown as RpcContext['terminals'], sessions: { get: () => ({ projectId: 'other', cwd: '/secret' }) } as unknown as SessionHostPort })
    for (const payload of [{ projectId: 'missing' }, { projectId: 'p1', sessionId: 's' }, { sessionId: 's' }]) {
      expect((await dispatchRpc('terminal.create', payload, ctx)).error).toBeDefined()
    }
    expect(create).not.toHaveBeenCalled()
  })

  it('passes delegate through acquire and yields only to the caller\'s own delegates, as session control does', async () => {
    const acquire = vi.fn(() => ({ leaseId: 'lease' }))
    const ctx = projectsOnlyHost({
      terminals: {} as RpcContext['terminals'],
      leases: { acquire } as unknown as RpcContext['leases'],
    })
    expect(await dispatchRpc('terminal.acquireControl', { terminalId: 't', delegate: 'phone-a', yields: true, ttlMs: 60_000 }, ctx)).toEqual({ result: { leaseId: 'lease' } })
    expect(acquire).toHaveBeenCalledWith({
      resource: { environmentId: 'env-1', terminalId: 't' }, holderClientId: 'c1',
      delegate: 'phone-a', yields: 'holder', ttlMs: 60_000,
    })
  })
})

describe('scoped native topic subscriptions', () => {
  it('refuses topics of another environment and unauthorized topic kinds before opening anything', async () => {
    const open = vi.fn()
    const ctx = projectsOnlyHost({
      sessions: {} as SessionHostPort,
      streams: { open } as unknown as RpcContext['streams'],
      client: { ...projectsOnlyHost().client, scopes: ['session:read'] },
    })
    const base = { subscriptionId: 'sub', afterSequence: '0' }
    expect((await dispatchRpc('topic.subscribe', { ...base, topics: [{ kind: 'sessionList', environmentId: 'other' }] }, ctx)).error?.code).toBe('identity_conflict')
    for (const kind of ['projects', 'terminalList', 'environment']) {
      expect((await dispatchRpc('topic.subscribe', { ...base, topics: [{ kind, environmentId: 'env-1' }] }, ctx)).error?.code).toBe('forbidden')
    }
    expect(open).not.toHaveBeenCalled()
  })

  it('rejects malformed workspace cursors before opening a stream', async () => {
    const ctx = projectsOnlyHost({ sessions: {} as SessionHostPort, streams: {} as RpcContext['streams'] })
    const payload = { subscriptionId: 'sub', afterSequence: '0', topics: [{ kind: 'sessionList', environmentId: 'env-1' }] }
    for (const topicCursors of [{ list: { epoch: '', version: 0 } }, { list: { epoch: 'e', version: -1 } }, { list: { epoch: 'e', version: 0.5 } }, []]) {
      expect((await dispatchRpc('topic.subscribe', { ...payload, topicCursors }, ctx)).error?.code).toBe('invalid_argument')
    }
  })
})

describe('session.create', () => {
  function sessionHost() {
    const create = vi.fn((input: { projectId: string }) => ({ sessionId: 's1', ...input }))
    const ctx = projectsOnlyHost({
      sessions: { create } as unknown as SessionHostPort,
      harnesses: {
        isSessionHarnessRunnable: () => true,
        readySessionHarnessIds: () => ['claude'],
      } as unknown as RpcContext['harnesses'],
      simulatedHarness: true,
    })
    return { ctx, create }
  }

  it('passes cwd and systemPromptAppend to the session host', async () => {
    const { ctx, create } = sessionHost()
    const res = await dispatchRpc(
      'session.create',
      { projectId: 'p1', cwd: '/tmp/p1', systemPromptAppend: 'You are a child session.' },
      ctx,
    )
    expect(res.error).toBeUndefined()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', cwd: '/tmp/p1', systemPromptAppend: 'You are a child session.' }),
    )
  })

  it('creates the session on the provider key the client chose', async () => {
    const { ctx, create } = sessionHost()
    const res = await dispatchRpc('session.create', { projectId: 'p1', options: { apiProviderId: 'cred-b' } }, ctx)
    expect(res.error).toBeUndefined()
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ apiProviderId: 'cred-b' }))
  })

  it('passes the external collaboration parent of a child launched from another machine', async () => {
    const { ctx, create } = sessionHost()
    const res = await dispatchRpc('session.create', { projectId: 'p1', externalParent: { sessionId: 'parent-a' } }, ctx)
    expect(res.error).toBeUndefined()
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ externalParent: { sessionId: 'parent-a' } }))
  })

  it.each([{ sessionId: 'native-id' }, { acpAgentId: 'grok' }, { worktreeBranch: 'HEAD', worktreeMode: 'detach' }])('refuses native creation on a host without the native port before writes: %j', async (selection) => {
    const { ctx, create } = sessionHost()
    const result = await dispatchRpc('session.create', { projectId: 'p1', ...selection }, ctx)
    expect(result.error?.code).toBe('unsupported')
    expect(create).not.toHaveBeenCalled()
  })

  it.each([
    [{ externalParent: { sessionId: '' } }, 'externalParent.sessionId is required'],
    [{ cwd: 'relative/dir' }, 'cwd not allowed for this project'],
    [{ cwd: '/elsewhere' }, 'cwd not allowed for this project'],
    [{ cwd: 42 }, 'cwd must be a string'],
    [{ systemPromptAppend: { text: 'x' } }, 'systemPromptAppend must be a string'],
  ])('rejects %j', async (extra, message) => {
    const { ctx, create } = sessionHost()
    const res = await dispatchRpc('session.create', { projectId: 'p1', ...extra }, ctx)
    expect(res.error).toEqual({ code: 'invalid_argument', message })
    expect(create).not.toHaveBeenCalled()
  })
})

describe('a partial git port', () => {
  function worktreeOnlyHost() {
    const activateWorktree = vi.fn(async () => ({ path: '/tmp/p1-wt' }))
    const fetch = vi.fn(async () => {})
    const ctx = projectsOnlyHost({
      client: {
        clientSessionId: 'c1',
        scopes: ['environment:read', 'project:read', 'workspace:read', 'workspace:write'],
        devicePublicKeyFingerprint: 'fp',
        devicePublicKeyPem: 'pem',
      } as RpcContext['client'],
      workspaceGit: {
        servedMethods: new Set(['git.worktreeActivate', 'git.fetch']),
        activateWorktree,
        fetch,
      } as unknown as RpcContext['workspaceGit'],
    })
    return { ctx, activateWorktree, fetch }
  }

  it('serves only the methods it names, awaiting an async worktree', async () => {
    const { ctx, activateWorktree } = worktreeOnlyHost()
    const res = await dispatchRpc('git.worktreeActivate', { projectId: 'p1', baseBranch: 'origin/HEAD', mode: 'branch', branchName: 'b' }, ctx)
    expect(res).toEqual({ result: { path: '/tmp/p1-wt' } })
    expect(activateWorktree).toHaveBeenCalledWith('p1', expect.objectContaining({ baseBranch: 'origin/HEAD', branchName: 'b' }))
    const status = await dispatchRpc('git.status', { projectId: 'p1' }, ctx)
    expect(status.error).toMatchObject({ code: 'not_found', details: { unsupported: true } })
  })

  it('fetches a named remote and refuses anything that is not one', async () => {
    const { ctx, fetch } = worktreeOnlyHost()
    expect(await dispatchRpc('git.fetch', { projectId: 'p1' }, ctx)).toEqual({ result: { ok: true } })
    expect(fetch).toHaveBeenCalledWith('p1', 'origin')
    const bad = await dispatchRpc('git.fetch', { projectId: 'p1', remote: '--upload-pack=x' }, ctx)
    expect(bad.error).toMatchObject({ code: 'invalid_argument' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('awaits async reads and maps their failures', async () => {
    const { ctx } = worktreeOnlyHost()
    const failed = Object.assign(new Error('git status timed out after 20000ms'), { code: 'internal' })
    ctx.workspaceGit = {
      status: vi.fn(async () => ({ isRepo: true, branch: 'main' })),
      statusAt: vi.fn(async () => { throw failed }),
    } as unknown as RpcContext['workspaceGit']
    expect(await dispatchRpc('git.status', { projectId: 'p1' }, ctx)).toEqual({ result: { isRepo: true, branch: 'main' } })
    const res = await dispatchRpc('git.status', { projectId: 'p1', cwd: '/tmp/p1-wt' }, ctx)
    expect(res.error).toMatchObject({ code: 'internal', message: failed.message })
  })

  it('advertises only the git methods it serves', async () => {
    const { ctx } = worktreeOnlyHost()
    const res = await dispatchRpc('environment.descriptor', {}, ctx)
    const { methods } = (res.result as ExecutionEnvironmentDescriptor).capabilities
    expect(methods).toEqual(expect.arrayContaining(['git.worktreeActivate', 'git.fetch']))
    expect(methods).not.toContain('git.status')
    expect(methods).not.toContain('git.worktrees')
  })

  it('refuses and leaves out the methods a host names unserved', async () => {
    const { ctx } = worktreeOnlyHost()
    const host = { ...ctx, unservedMethods: new Set(['git.fetch']) }
    const res = await dispatchRpc('environment.descriptor', {}, host)
    expect((res.result as ExecutionEnvironmentDescriptor).capabilities.methods).not.toContain('git.fetch')
    expect((await dispatchRpc('git.fetch', {}, host)).error).toMatchObject({ details: { unsupported: true } })
  })
})

describe('git.clone into an existing folder', () => {
  it('registers an unregistered checkout of the same origin instead of failing', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'clone-existing-'))
    try {
      const existing = join(parent, 'app')
      execFileSync('git', ['init', '-q', existing])
      execFileSync('git', ['-C', existing, 'remote', 'add', 'origin', 'git@github.com:acme/app.git'])
      const open = vi.fn((path: string, name?: string) => ({ projectId: 'p-app', path, name }))
      const ctx = projectsOnlyHost({
        client: {
          clientSessionId: 'c1',
          scopes: ['project:manage'],
          devicePublicKeyFingerprint: 'fp',
          devicePublicKeyPem: 'pem',
        } as RpcContext['client'],
        projects: { ...projects, open } as unknown as ProjectsPort,
      })
      const res = await dispatchRpc('git.clone', {
        remoteUrl: 'https://github.com/acme/app', parentPath: parent, ifExists: 'reuse-or-rename',
      }, ctx)
      expect(res).toEqual({ result: { projectId: 'p-app', path: existing, name: 'app', reused: true } })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})

describe('a partial collaboration port', () => {
  const profiles = [{ id: 'claude-base', name: 'Claude', harnessId: 'claude', defaultConfig: {}, models: [], efforts: [], apiProviders: [] }]
  const ctx = () => projectsOnlyHost({
    collaboration: {
      servedMethods: new Set(['collaboration.listProfiles']),
      listProfiles: () => profiles,
    } as unknown as RpcContext['collaboration'],
  })

  it('lists profiles and answers the mailbox methods unsupported', async () => {
    expect(await dispatchRpc('collaboration.listProfiles', {}, ctx())).toEqual({ result: profiles })
    const send = await dispatchRpc('collaboration.send', {}, ctx())
    expect(send.error).toMatchObject({ code: 'not_found', details: { method: 'collaboration.send', unsupported: true } })
  })

  it('advertises exactly the methods a partial port serves, and its extensions', async () => {
    const res = await dispatchRpc('environment.descriptor', {}, { ...ctx(), extensionMethods: new Set(['collaboration.history']) })
    const { methods } = (res.result as ExecutionEnvironmentDescriptor).capabilities
    expect(methods).toEqual(expect.arrayContaining(['collaboration.listProfiles', 'collaboration.history']))
    expect(methods).not.toContain('collaboration.send')
  })
})

describe('session.fork without a provider-side fork', () => {
  const methods = async (sessions: Partial<SessionHostPort>) => {
    const res = await dispatchRpc('environment.descriptor', {}, projectsOnlyHost({ sessions: sessions as SessionHostPort }))
    return (res.result as ExecutionEnvironmentDescriptor).capabilities.methods
  }

  it('is unserved on a host with neither forkOnHost nor forkHarnessResume', async () => {
    expect(await methods({ get: () => null })).not.toContain('session.fork')
    const res = await dispatchRpc('session.fork', { sessionId: 's1' }, projectsOnlyHost({ sessions: { get: () => null } as unknown as SessionHostPort }))
    expect(res.error).toMatchObject({ code: 'not_found', details: { method: 'session.fork', unsupported: true } })
  })

  it('is served by a session host that forks on its own', async () => {
    expect(await methods({ get: () => null, forkOnHost: vi.fn() })).toContain('session.fork')
  })
})

describe('sandbox probes on a GUI-launched host', () => {
  it('waits for the host PATH before looking up bwrap / socat on Linux', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    const path = process.env.PATH
    // The login shell's PATH is the only one with bwrap / socat on it.
    const shellBin = mkdtempSync(join(tmpdir(), 's1-shell-bin-'))
    for (const bin of ['bwrap', 'socat']) writeFileSync(join(shellBin, bin), '#!/bin/sh\n', { mode: 0o755 })
    Object.defineProperty(process, 'platform', { value: 'linux' })
    resetSandboxCapabilityCacheForTests()
    try {
      const ctx = projectsOnlyHost()
      ctx.hooks = {
        ...ctx.hooks,
        pathReady: async () => {
          process.env.PATH = `${shellBin}:${path}`
        },
      }
      const info = await dispatchRpc('environment.systemInfo', {}, ctx)
      expect((info.result as { sandbox: unknown }).sandbox).toMatchObject({ ok: true, bwrap: true, socat: true })
    } finally {
      Object.defineProperty(process, 'platform', platform)
      process.env.PATH = path
      rmSync(shellBin, { recursive: true, force: true })
      resetSandboxCapabilityCacheForTests()
    }
  })
})
