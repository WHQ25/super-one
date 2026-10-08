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
  mcp: false,
  fileTransfer: false,
  nodeAdmin: false,
  coldSessionResume: false,
  turnReattach: false,
  hostActionV1: false,
  drafts: false,
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
    expect(descriptor.capabilities).toMatchObject({
      sessions: false,
      terminal: false,
      workspaceFs: false,
      git: false,
      worktrees: false,
      collaboration: false,
      syncZone: false,
      harnessIds: [],
    })
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

  it('passes the external collaboration parent of a child launched from another machine', async () => {
    const { ctx, create } = sessionHost()
    const res = await dispatchRpc('session.create', { projectId: 'p1', externalParent: { sessionId: 'parent-a' } }, ctx)
    expect(res.error).toBeUndefined()
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ externalParent: { sessionId: 'parent-a' } }))
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
