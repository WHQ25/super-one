import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { dispatchRpc, type RpcContext } from './handlers'
import type { AuthenticatedClient } from '../auth/auth-service'
import { openNodeDatabase } from '../db/database'
import { ProviderStore } from '../provider/provider-store'
import { createCliRpcHostHooks } from './host-hooks'

const getNodeCodexModelCatalog = vi.hoisted(() => vi.fn(async () => [] as Array<{
  id: string
  name: string
  description: string
  isDefault?: boolean
}>))
const getNodeClaudeModelCatalog = vi.hoisted(() => vi.fn(async () => [] as Array<{
  id: string
  name: string
  description: string
}>))

vi.mock('../session/codex-model-catalog', () => ({
  getNodeCodexModelCatalog,
}))
vi.mock('../session/claude-model-catalog', () => ({
  getNodeClaudeModelCatalog,
}))
vi.mock('../session/claude-turn-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../session/claude-turn-runner')>()
  return { ...actual, resolveClaudeBinaryPath: () => '/bin/claude' }
})

const dirs: string[] = []

afterEach(() => {
  getNodeCodexModelCatalog.mockReset()
  getNodeClaudeModelCatalog.mockReset()
  getNodeClaudeModelCatalog.mockResolvedValue([])
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function client(): AuthenticatedClient {
  return {
    clientSessionId: 'c1',
    deviceId: 'd1',
    scopes: ['environment:read', 'workspace:read'],
    pairedAt: Date.now(),
  } as unknown as AuthenticatedClient
}

function ctx(providers: RpcContext['providers']): RpcContext {
  const dir = mkdtempSync(join(tmpdir(), 'codex-list-'))
  dirs.push(dir)
  return {
    client: client(),
    settingsConfigPath: join(dir, 'config.json'),
    providers,
    hooks: createCliRpcHostHooks(),
    startedAt: Date.now(),
  } as unknown as RpcContext
}

function emptyProviders(): ProviderStore {
  return {
    listBindings: () => [],
    getCredentialDecrypted: () => null,
    listCustomPlatforms: () => [],
  } as unknown as ProviderStore
}

describe('provider.listModels codex', () => {
  it('returns the probed catalog instead of the built-in slug table', async () => {
    getNodeCodexModelCatalog.mockResolvedValue([
      { id: 'gpt-5.5', name: 'GPT-5.5', description: '', isDefault: true },
    ])

    const res = await dispatchRpc(
      'provider.listModels',
      { harness: 'codex', apiProviderId: 'codex-account:cli' },
      ctx(emptyProviders()),
    )

    expect(res.error).toBeUndefined()
    expect(res.result).toEqual([
      { id: 'gpt-5.5', name: 'GPT-5.5', description: '', isDefault: true },
    ])
    expect(getNodeCodexModelCatalog).toHaveBeenCalledWith(expect.objectContaining({
      apiProviderId: 'codex-account:cli',
    }))
  })

  it('keeps the built-in slug table when the probe is empty', async () => {
    getNodeCodexModelCatalog.mockResolvedValue([])

    const res = await dispatchRpc(
      'provider.listModels',
      { harness: 'codex' },
      ctx(emptyProviders()),
    )

    expect((res.result as Array<{ id: string }>).map((model) => model.id)).toEqual([
      'gpt-5.2', 'gpt-5.1', 'o3',
    ])
  })

  it('keeps a credential catalog and does not probe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-list-provider-'))
    dirs.push(dir)
    const db = openNodeDatabase(join(dir, 'state.sqlite'))
    const providers = new ProviderStore(db, join(dir, 'provider-secrets.key'))
    providers.upsertCustomPlatform({
      id: 'custom:relay',
      brand: 'relay',
      name: 'Relay',
      plans: [{
        id: 'api',
        name: 'API',
        auth: 'api-key',
        baseUrl: 'https://relay.example',
        endpoints: [{
          id: 'openai',
          protocols: ['openai-chat'],
          models: [{ id: 'relay-gpt', name: 'Relay GPT' }],
        }],
      }],
    })
    const cred = providers.createCredential({
      platformId: 'custom:relay',
      planId: 'api',
      name: 'relay',
      secret: 'sk-upstream-secret',
    })
    providers.setBinding({ consumer: 'chat:codex', credentialId: cred.id })

    const res = await dispatchRpc(
      'provider.listModels',
      { harness: 'codex' },
      ctx(providers),
    )
    db.close()

    expect((res.result as Array<{ id: string }>).map((model) => model.id)).toEqual(['relay-gpt'])
    expect(getNodeCodexModelCatalog).not.toHaveBeenCalled()
  })

  it('does not probe Codex while listing Claude models', async () => {
    const res = await dispatchRpc(
      'provider.listModels',
      { harness: 'claude' },
      ctx(emptyProviders()),
    )

    expect((res.result as Array<{ id: string }>).map((model) => model.id)).toContain('claude-opus-5-5')
    expect(getNodeCodexModelCatalog).not.toHaveBeenCalled()
    expect(getNodeClaudeModelCatalog).toHaveBeenCalled()
  })

  it('returns the probed Claude catalog instead of the built-in slug table', async () => {
    getNodeClaudeModelCatalog.mockResolvedValue([
      { id: 'opus-live', name: 'Opus', description: '' },
    ])

    const res = await dispatchRpc(
      'provider.listModels',
      { harness: 'claude' },
      ctx(emptyProviders()),
    )

    expect(res.result).toEqual([{ id: 'opus-live', name: 'Opus', description: '' }])
  })

  it('forwards a model-list refresh so the node probes again', async () => {
    getNodeClaudeModelCatalog.mockResolvedValue([{ id: 'opus', name: 'Opus', description: '' }])
    getNodeCodexModelCatalog.mockResolvedValue([{ id: 'gpt-live', name: 'GPT', description: '', isDefault: true }])

    await dispatchRpc('provider.listModels', { harness: 'claude', force: true }, ctx(emptyProviders()))
    await dispatchRpc('provider.listModels', { harness: 'codex', force: true }, ctx(emptyProviders()))

    expect(getNodeClaudeModelCatalog).toHaveBeenCalledWith(expect.objectContaining({ force: true }))
    expect(getNodeCodexModelCatalog).toHaveBeenCalledWith(expect.objectContaining({ force: true }))
  })

  it('does not probe Claude for a custom credential with no models', async () => {
    const res = await dispatchRpc(
      'provider.listModels',
      { harness: 'claude', apiProviderId: 'custom:empty' },
      ctx(emptyProviders()),
    )

    expect((res.result as Array<{ id: string }>).map((model) => model.id)).toContain('claude-opus-5-5')
    expect(getNodeClaudeModelCatalog).not.toHaveBeenCalled()
  })
})
