/**
 * Desktop remote gateway startup path: harness.resources + sessionProviders + codex.* RPC.
 */
import { describe, expect, it, vi } from 'vitest'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'
import {
  fetchRemoteHarnessResources,
  listRemoteSessionProvidersForPath,
  remoteCodexGetAuthStatus,
  remoteCodexGetRateLimits,
  remoteCodexPluginsList,
  remoteCodexSetAuth,
} from './remote-resources'
import type { EnvironmentHost } from './environment-host'
import type { NodeRpcClient } from './node-rpc-client'

describe('RemoteEnvironmentGateway harness.resources / sessionProviders', () => {
  it('rpc harness.resources with projectId', async () => {
    const rpc = vi.fn(async (method: string, payload?: unknown) => {
      if (method === 'harness.resources') {
        return {
          claude: {
            models: [{ id: 'claude-sonnet-4-5', name: 'Sonnet' }],
            account: {},
            slashCommands: [],
            skills: [{ name: 'ship', description: '', argumentHint: '', isSkill: true }],
            commands: [],
            agents: [],
            outputStyles: [],
          },
          codex: { models: [], prompts: [] },
          opencode: { models: [], agents: [], commands: [] },
          acp: { agents: [] },
        }
      }
      return {}
    })
    const client = { rpc } as unknown as NodeRpcClient
    const gw = new RemoteEnvironmentGateway(client)
    const result = (await gw.harnessResources({
      projectId: 'p1',
      harnessId: 'claude',
    })) as { claude: { models: Array<{ id: string }>; skills: Array<{ name: string }> } }
    expect(rpc).toHaveBeenCalledWith('harness.resources', {
      projectId: 'p1',
      harnessId: 'claude',
      apiProviderId: null,
    })
    expect(result.claude.models[0]?.id).toBe('claude-sonnet-4-5')
    expect(result.claude.skills[0]?.name).toBe('ship')
  })

  it('sessionProviders.list returns CRUD profiles', async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'sessionProviders.list') {
        return {
          providers: [
            { id: 'claude-base', harnessId: 'claude', name: 'Claude (Base)', isBase: true },
            { id: 'claude-x', harnessId: 'claude', name: 'Custom', isBase: false },
          ],
        }
      }
      return {}
    })
    const client = { rpc } as unknown as NodeRpcClient
    const gw = new RemoteEnvironmentGateway(client)
    const result = (await gw.sessionProvidersList()) as {
      providers: Array<{ id: string }>
    }
    expect(rpc).toHaveBeenCalledWith('sessionProviders.list', {})
    expect(result.providers.map((p) => p.id)).toEqual(['claude-base', 'claude-x'])
  })

  it('sessionProviders.create round-trips config on lab node path', async () => {
    const rpc = vi.fn(async (method: string, payload?: unknown) => {
      if (method === 'sessionProviders.create') {
        const p = payload as { harnessId: string; name: string; config?: unknown }
        return {
          provider: {
            id: 'claude-lab',
            harnessId: p.harnessId,
            name: p.name,
            isBase: false,
            config: p.config ?? {},
            createdAt: 1,
            updatedAt: 1,
          },
        }
      }
      return {}
    })
    const client = { rpc } as unknown as NodeRpcClient
    const gw = new RemoteEnvironmentGateway(client)
    const result = (await gw.sessionProvidersCreate({
      harnessId: 'claude',
      name: 'Lab',
      config: { model: 'claude-sonnet-4-5', effort: 'high' },
    })) as { provider: { id: string; config: unknown } }
    expect(rpc).toHaveBeenCalledWith('sessionProviders.create', {
      harnessId: 'claude',
      name: 'Lab',
      config: { model: 'claude-sonnet-4-5', effort: 'high' },
    })
    expect(result.provider.config).toEqual({ model: 'claude-sonnet-4-5', effort: 'high' })
  })
})

describe('remote-resources harness discovery helpers', () => {
  it('fetchRemoteHarnessResources routes through gateway', async () => {
    const harnessResources = vi.fn(async () => ({
      claude: { models: [{ id: 'm1' }], skills: [], commands: [], agents: [], slashCommands: [], account: {}, outputStyles: [] },
    }))
    const gw = { harnessResources } as unknown as RemoteEnvironmentGateway
    Object.setPrototypeOf(gw, RemoteEnvironmentGateway.prototype)

    const host = {
      connections: { listKnown: () => [{ connectionId: 'conn-1', environmentId: 'env-1' }] },
      listProjects: async () => [{ projectId: 'proj-1', path: '/work/app', name: 'app' }],
      openProject: async () => ({ projectId: 'proj-1', path: '/work/app', name: 'app' }),
      getGateway: () => gw,
    } as unknown as EnvironmentHost

    const result = await fetchRemoteHarnessResources(host, 'remote:conn-1:/work/app', {
      harnessId: 'claude',
    })
    expect(harnessResources).toHaveBeenCalledWith({
      projectId: 'proj-1',
      harnessId: 'claude',
      apiProviderId: null,
    })
    expect(result).toBeTruthy()
  })

  it('listRemoteSessionProvidersForPath returns providers array', async () => {
    const sessionProvidersList = vi.fn(async () => ({
      providers: [{ id: 'claude-base' }],
    }))
    const gw = { sessionProvidersList } as unknown as RemoteEnvironmentGateway
    Object.setPrototypeOf(gw, RemoteEnvironmentGateway.prototype)

    const host = {
      connections: { listKnown: () => [{ connectionId: 'conn-1', environmentId: 'env-1' }] },
      listProjects: async () => [{ projectId: 'proj-1', path: '/work/app', name: 'app' }],
      openProject: async () => ({ projectId: 'proj-1', path: '/work/app', name: 'app' }),
      getGateway: () => gw,
    } as unknown as EnvironmentHost

    const providers = await listRemoteSessionProvidersForPath(host, 'remote:conn-1:/work/app')
    expect(providers).toEqual([{ id: 'claude-base' }])
  })
})

describe('RemoteEnvironmentGateway codex.* admin surface', () => {
  it('rpc codex.getAuthStatus with projectId', async () => {
    const rpc = vi.fn(async (method: string, payload?: unknown) => {
      if (method === 'codex.getAuthStatus') {
        return {
          mode: 'auto',
          resolvedMode: 'chatgpt',
          hasEnvApiKey: false,
          hasSessionApiKey: false,
          isRunning: false,
        }
      }
      return {}
    })
    const client = { rpc } as unknown as NodeRpcClient
    const gw = new RemoteEnvironmentGateway(client)
    const status = (await gw.codexGetAuthStatus('p1')) as {
      mode: string
      resolvedMode: string
    }
    expect(rpc).toHaveBeenCalledWith('codex.getAuthStatus', { projectId: 'p1' })
    expect(status.mode).toBe('auto')
    expect(status.resolvedMode).toBe('chatgpt')
  })

  it('rpc codex.setAuth and codex.getRateLimits', async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'codex.setAuth') {
        return {
          mode: 'chatgpt',
          resolvedMode: 'chatgpt',
          hasEnvApiKey: false,
          hasSessionApiKey: false,
          isRunning: false,
        }
      }
      if (method === 'codex.getRateLimits') {
        return { primary: null, secondary: null, planType: null, resetCredits: null }
      }
      return {}
    })
    const client = { rpc } as unknown as NodeRpcClient
    const gw = new RemoteEnvironmentGateway(client)
    await gw.codexSetAuth('p1', { mode: 'chatgpt' })
    expect(rpc).toHaveBeenCalledWith('codex.setAuth', { projectId: 'p1', mode: 'chatgpt' })
    const limits = await gw.codexGetRateLimits('p1', null)
    expect(rpc).toHaveBeenCalledWith('codex.getRateLimits', {
      projectId: 'p1',
      apiProviderId: null,
    })
    expect(limits).toMatchObject({ primary: null })
  })

  it('rpc Codex account login lifecycle to the remote node', async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'codex.getAccountStatus') return { signedIn: false }
      if (method === 'codex.accountLoginStart') {
        return { type: 'chatgptDeviceCode', loginId: 'login-1', userCode: 'ABCD-EFGH' }
      }
      return { ok: true }
    })
    const gw = new RemoteEnvironmentGateway({ rpc } as unknown as NodeRpcClient)

    await gw.codexGetAccountStatus('p1')
    await gw.codexAccountLoginStart('p1')
    await gw.codexAccountLoginCancel('login-1')
    await gw.codexAccountLogout('p1')

    expect(rpc).toHaveBeenNthCalledWith(1, 'codex.getAccountStatus', { projectId: 'p1' })
    expect(rpc).toHaveBeenNthCalledWith(2, 'codex.accountLoginStart', { projectId: 'p1' })
    expect(rpc).toHaveBeenNthCalledWith(3, 'codex.accountLoginCancel', { loginId: 'login-1' })
    expect(rpc).toHaveBeenNthCalledWith(4, 'codex.accountLogout', { projectId: 'p1' })
  })

  it('rpc codex.plugins.list', async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'codex.plugins.list') {
        return { plugins: [{ key: 'demo@market', name: 'demo' }], provider: 'codex' }
      }
      return {}
    })
    const client = { rpc } as unknown as NodeRpcClient
    const gw = new RemoteEnvironmentGateway(client)
    const result = (await gw.codexPluginsList('p1')) as { plugins: Array<{ key: string }> }
    expect(rpc).toHaveBeenCalledWith('codex.plugins.list', {
      projectId: 'p1',
      marketplace: false,
      apiProviderId: null,
    })
    expect(result.plugins[0]?.key).toBe('demo@market')
  })
})

describe('remote-resources codex admin helpers', () => {
  it('remoteCodexGetAuthStatus / setAuth / pluginsList route through gateway', async () => {
    const codexGetAuthStatus = vi.fn(async () => ({
      mode: 'apiKey',
      resolvedMode: 'apiKey',
      hasEnvApiKey: false,
      hasSessionApiKey: true,
      isRunning: false,
    }))
    const codexSetAuth = vi.fn(async () => ({
      mode: 'apiKey',
      resolvedMode: 'apiKey',
      hasEnvApiKey: false,
      hasSessionApiKey: true,
      isRunning: false,
    }))
    const codexGetRateLimits = vi.fn(async () => null)
    const codexPluginsList = vi.fn(async () => ({ plugins: [], provider: 'codex' }))
    const gw = {
      codexGetAuthStatus,
      codexSetAuth,
      codexGetRateLimits,
      codexPluginsList,
    } as unknown as RemoteEnvironmentGateway
    Object.setPrototypeOf(gw, RemoteEnvironmentGateway.prototype)

    const host = {
      connections: { listKnown: () => [{ connectionId: 'conn-1', environmentId: 'env-1' }] },
      listProjects: async () => [{ projectId: 'proj-1', path: '/work/app', name: 'app' }],
      openProject: async () => ({ projectId: 'proj-1', path: '/work/app', name: 'app' }),
      getGateway: () => gw,
    } as unknown as EnvironmentHost

    const folder = 'remote:conn-1:/work/app'
    const auth = await remoteCodexGetAuthStatus(host, folder)
    expect(codexGetAuthStatus).toHaveBeenCalledWith('proj-1')
    expect(auth).toMatchObject({ mode: 'apiKey', hasSessionApiKey: true })

    await remoteCodexSetAuth(host, folder, { mode: 'apiKey', apiKey: 'sk-test' })
    expect(codexSetAuth).toHaveBeenCalledWith('proj-1', { mode: 'apiKey', apiKey: 'sk-test' })

    await remoteCodexGetRateLimits(host, folder, null)
    expect(codexGetRateLimits).toHaveBeenCalledWith('proj-1', null)

    await remoteCodexPluginsList(host, folder)
    expect(codexPluginsList).toHaveBeenCalledWith('proj-1', undefined)
  })
})
