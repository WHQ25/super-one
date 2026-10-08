import { describe, expect, it } from 'vitest'
import type { ExecutionEnvironmentDescriptor } from '@superone/shared/environment'
import { dispatchRpc } from './rpc-dispatch'
import type { HostCapabilityFlags, ProjectsPort, RpcContext, RpcHostHooks } from './rpc-context'
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
