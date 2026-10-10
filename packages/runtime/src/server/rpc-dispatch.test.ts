import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ExecutionEnvironmentDescriptor } from '@superone/shared/environment'
import { dispatchRpc } from './rpc-dispatch'
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

  it('passes delegate and yields through acquire just as session control does', async () => {
    const acquire = vi.fn(() => ({ leaseId: 'lease' }))
    const ctx = projectsOnlyHost({
      terminals: {} as RpcContext['terminals'],
      leases: { acquire } as unknown as RpcContext['leases'],
    })
    expect(await dispatchRpc('terminal.acquireControl', { terminalId: 't', delegate: 'phone-a', yields: true, ttlMs: 60_000 }, ctx)).toEqual({ result: { leaseId: 'lease' } })
    expect(acquire).toHaveBeenCalledWith({
      resource: { environmentId: 'env-1', terminalId: 't' }, holderClientId: 'c1',
      delegate: 'phone-a', yields: true, ttlMs: 60_000,
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
