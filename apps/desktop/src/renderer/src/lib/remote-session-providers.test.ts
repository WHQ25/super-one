import { describe, expect, it, vi } from 'vitest'
import {
  createSessionProviderForProject,
  listSessionProvidersForProject,
} from './remote-session-providers'

describe('remote-session-providers', () => {
  it('list on remote project uses environment.listRemoteSessionProviders', async () => {
    const listRemoteSessionProviders = vi.fn(async () => ({
      providers: [
        { id: 'claude-base', harnessId: 'claude', name: 'Claude (Base)', isBase: true },
        {
          id: 'claude-team',
          harnessId: 'claude',
          name: 'Team',
          isBase: false,
          config: { model: 'x' },
        },
      ],
    }))
    const providers = await listSessionProvidersForProject('remote:conn-1:/work/app', {
      env: { listRemoteSessionProviders },
    })
    expect(listRemoteSessionProviders).toHaveBeenCalledWith('conn-1', undefined)
    expect(providers.map((p) => p.id)).toEqual(['claude-base', 'claude-team'])
  })

  it('create on remote project uses environment.createRemoteSessionProvider', async () => {
    const createRemoteSessionProvider = vi.fn(async (_cid: string, input: { name: string }) => ({
      provider: {
        id: 'claude-new',
        harnessId: 'claude',
        name: input.name,
        isBase: false,
        config: { model: 'm' },
      },
    }))
    const created = await createSessionProviderForProject(
      'remote:lab:/tmp/p',
      { harnessId: 'claude', name: 'New', config: { model: 'm' } },
      { env: { createRemoteSessionProvider } },
    )
    expect(createRemoteSessionProvider).toHaveBeenCalledWith('lab', {
      harnessId: 'claude',
      name: 'New',
      config: { model: 'm' },
    })
    expect(created?.id).toBe('claude-new')
    expect(created?.config).toEqual({ model: 'm' })
  })

  it('list on local path does not call remote env', async () => {
    const listRemoteSessionProviders = vi.fn()
    const providers = await listSessionProvidersForProject('/local/app', {
      env: { listRemoteSessionProviders },
    })
    expect(listRemoteSessionProviders).not.toHaveBeenCalled()
    // No window.app.sessionProviders in unit test → empty
    expect(providers).toEqual([])
  })
})
