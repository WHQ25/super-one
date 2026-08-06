import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { dispatchRpc, type RpcContext } from './handlers'
import type { AuthenticatedClient } from '../auth/auth-service'
import type { NodeIdentity } from '../identity'
import { loadNodeAgentSettings } from '@superone/runtime/settings'

function client(scopes: AuthenticatedClient['scopes']): AuthenticatedClient {
  return {
    clientSessionId: 'c1',
    deviceId: 'd1',
    scopes,
    pairedAt: Date.now(),
  } as AuthenticatedClient
}

function baseCtx(over: Partial<RpcContext> & { settingsConfigPath: string }): RpcContext {
  return {
    client: client(['environment:read', 'node:admin', 'session:operate', 'session:read']),
    identity: {
      environmentId: 'env-1',
      label: 'test',
      privateKeyPem: '',
      publicKeyPem: '',
      publicKeyFingerprint: 'fp',
      bindingHash: 'bh',
      nodeHome: '/tmp',
      identityConflict: false,
      persistedBindingHash: null,
    } as NodeIdentity,
    terminals: {} as RpcContext['terminals'],
    projects: {
      get: () => ({ projectId: 'p1', path: '/tmp/p', name: 'p', repoIdentity: null }),
      touch: () => {},
    } as unknown as RpcContext['projects'],
    workspaceFs: {} as RpcContext['workspaceFs'],
    workspaceGit: {} as RpcContext['workspaceGit'],
    workspaceWatch: {} as RpcContext['workspaceWatch'],
    workspaceTailWatch: {} as RpcContext['workspaceTailWatch'],
    sessions: {
      get: () => ({
        sessionId: 's1',
        projectId: 'p1',
        harnessId: 'claude',
        providerId: 'claude',
        title: null,
        status: 'idle',
        transcript: [],
        pendingInteraction: null,
        providerResume: null,
        cwd: null,
        createdAt: 0,
        updatedAt: 0,
        isPinned: false,
        isHidden: false,
        isUserRenamed: false,
        controllerClientSessionId: 'c1',
        hostActionCapabilityVersion: 0,
        hostActionToolGroups: [],
        alwaysAllowedTools: [],
      }),
      send: vi.fn(async (input: { model?: string | null; sandboxMode?: string | null }) => input),
      create: vi.fn(() => ({
        sessionId: 's-new',
        projectId: 'p1',
        harnessId: 'claude',
        providerId: 'claude',
        title: null,
        status: 'idle',
        transcript: [],
        pendingInteraction: null,
        providerResume: null,
        cwd: null,
        createdAt: 0,
        updatedAt: 0,
        isPinned: false,
        isHidden: false,
        isUserRenamed: false,
        controllerClientSessionId: 'c1',
        hostActionCapabilityVersion: 0,
        hostActionToolGroups: [],
        alwaysAllowedTools: [],
      })),
    } as unknown as RpcContext['sessions'],
    harnesses: {
      isSessionHarnessRunnable: () => true,
      readySessionHarnessIds: () => ['claude'],
    } as unknown as RpcContext['harnesses'],
    leases: {} as RpcContext['leases'],
    events: {} as RpcContext['events'],
    collaboration: {} as RpcContext['collaboration'],
    idempotency: {
      payloadHash: () => 'h',
      runExclusive: async (
        _a: string,
        _b: string,
        _c: string,
        _d: string,
        fn: () => Promise<unknown>,
      ) => fn(),
    } as unknown as RpcContext['idempotency'],
    providers: {} as RpcContext['providers'],
    automations: {} as RpcContext['automations'],
    automationService: {} as RpcContext['automationService'],
    sessionProviders: {
      list: () => [],
      listByHarness: () => [],
      get: () => null,
      getBase: () => {
        throw new Error('missing')
      },
      create: () => {
        throw new Error('missing')
      },
      update: () => {
        throw new Error('missing')
      },
      delete: () => false,
    },
    startedAt: Date.now(),
    simulatedHarness: true,
    idempotencyKey: 'idem-1',
    ...over,
  }
}

describe('settings RPC', () => {
  let dir: string
  let configPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'settings-rpc-'))
    configPath = join(dir, 'config.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('settings.patch sets claude.defaultModel and settings.get returns it', async () => {
    const ctx = baseCtx({ settingsConfigPath: configPath })
    const patched = await dispatchRpc(
      'settings.patch',
      { patch: { claude: { defaultModel: 'claude-sonnet-4-5' } } },
      ctx,
    )
    expect(patched.error).toBeUndefined()
    const settings = (patched.result as { settings: { claude: { defaultModel: string } } })
      .settings
    expect(settings.claude.defaultModel).toBe('claude-sonnet-4-5')
    expect(loadNodeAgentSettings(configPath).claude.defaultModel).toBe('claude-sonnet-4-5')

    const got = await dispatchRpc('settings.get', {}, ctx)
    expect(
      (got.result as { settings: { claude: { defaultModel: string } } }).settings.claude
        .defaultModel,
    ).toBe('claude-sonnet-4-5')
  })

  it('settings.patch requires node:admin', async () => {
    const ctx = baseCtx({
      settingsConfigPath: configPath,
      client: client(['environment:read']),
    })
    const res = await dispatchRpc(
      'settings.patch',
      { patch: { claude: { defaultModel: 'x' } } },
      ctx,
    )
    expect(res.error?.code).toBe('forbidden')
  })

  it('session.send without model uses settings.claude.defaultModel', async () => {
    const ctx = baseCtx({ settingsConfigPath: configPath })
    await dispatchRpc(
      'settings.patch',
      { patch: { claude: { defaultModel: 'claude-opus-4', sandboxMode: 'on' } } },
      ctx,
    )
    const send = ctx.sessions.send as ReturnType<typeof vi.fn>
    const res = await dispatchRpc(
      'session.send',
      {
        sessionId: 's1',
        text: 'hi',
        leaseId: 'l1',
        generation: '1',
      },
      ctx,
    )
    expect(res.error).toBeUndefined()
    expect(send).toHaveBeenCalled()
    const arg = send.mock.calls[0][0] as { model?: string; sandboxMode?: string }
    expect(arg.model).toBe('claude-opus-4')
    expect(arg.sandboxMode).toBe('on')
  })

  it('sandbox.probe returns capability booleans', async () => {
    const ctx = baseCtx({
      settingsConfigPath: configPath,
      client: client(['environment:read']),
    })
    const res = await dispatchRpc('sandbox.probe', {}, ctx)
    expect(res.error).toBeUndefined()
    const body = res.result as {
      ok: boolean
      bwrap: boolean
      socat: boolean
      supportLevel: string
    }
    expect(typeof body.ok).toBe('boolean')
    expect(typeof body.bwrap).toBe('boolean')
    expect(typeof body.socat).toBe('boolean')
    expect(typeof body.supportLevel).toBe('string')
  })

  it('session.create seeds model/effort from session_providers.config when providerId matches', async () => {
    const patchSettings = vi.fn((_id: string, patch: Record<string, unknown>) => ({
      sessionId: 's-new',
      projectId: 'p1',
      harnessId: 'claude',
      providerId: 'claude-team',
      ...patch,
    }))
    const ctx = baseCtx({
      settingsConfigPath: configPath,
      sessions: {
        create: vi.fn(() => ({
          sessionId: 's-new',
          projectId: 'p1',
          harnessId: 'claude',
          providerId: 'claude-team',
          title: null,
          status: 'idle',
          transcript: [],
          pendingInteraction: null,
          providerResume: null,
          cwd: null,
          createdAt: 0,
          updatedAt: 0,
          isPinned: false,
          isHidden: false,
          isUserRenamed: false,
          controllerClientSessionId: 'c1',
          hostActionCapabilityVersion: 0,
          hostActionToolGroups: [],
          alwaysAllowedTools: [],
        })),
        patchSettings,
        get: () => null,
        send: vi.fn(),
      } as unknown as RpcContext['sessions'],
      sessionProviders: {
        list: () => [],
        listByHarness: () => [],
        get: (id: string) =>
          id === 'claude-team'
            ? {
                id: 'claude-team',
                harnessId: 'claude' as const,
                name: 'Team',
                isBase: false,
                config: { model: 'claude-opus-4', effort: 'high' },
                createdAt: 0,
                updatedAt: 0,
              }
            : null,
        getBase: () => {
          throw new Error('missing')
        },
        create: () => {
          throw new Error('missing')
        },
        update: () => {
          throw new Error('missing')
        },
        delete: () => false,
      },
    })
    const res = await dispatchRpc(
      'session.create',
      { projectId: 'p1', harnessId: 'claude', providerId: 'claude-team' },
      ctx,
    )
    expect(res.error).toBeUndefined()
    expect(patchSettings).toHaveBeenCalledWith('s-new', {
      model: 'claude-opus-4',
      effort: 'high',
    })
    const defaults = (res.result as { defaults: { model: string; effort: string } }).defaults
    expect(defaults.model).toBe('claude-opus-4')
    expect(defaults.effort).toBe('high')
  })
})
