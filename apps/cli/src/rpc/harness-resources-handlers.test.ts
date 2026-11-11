import { afterEach, describe, expect, it, vi } from 'vitest'

const getNodeCodexModelCatalog = vi.hoisted(() => vi.fn(async () => [] as Array<{
  id: string
  name: string
  description: string
  isDefault?: boolean
}>))

vi.mock('../session/codex-model-catalog', () => ({
  getNodeCodexModelCatalog,
}))
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { dispatchHarnessResourcesRpc } from './harness-resources-handlers'
import type { AuthenticatedClient } from '../auth/auth-service'
import type { ProjectRegistry } from '../workspace/project-registry'
import { ProviderStore } from '../provider/provider-store'
import { openNodeDatabase } from '../db/database'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function client(scopes: AuthenticatedClient['scopes']): AuthenticatedClient {
  return {
    clientSessionId: 'c1',
    deviceId: 'd1',
    scopes,
    pairedAt: Date.now(),
  } as unknown as AuthenticatedClient
}

describe('harness.resources RPC', () => {
  it('returns models + project skills without desktop cache', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'hr-rpc-'))
    const homeDir = mkdtempSync(join(tmpdir(), 'hr-rpc-home-'))
    dirs.push(projectDir, homeDir)
    mkdirSync(join(projectDir, '.claude', 'skills', 'demo'), { recursive: true })
    writeFileSync(
      join(projectDir, '.claude', 'skills', 'demo', 'SKILL.md'),
      '---\ndescription: Demo skill\n---\n',
    )
    mkdirSync(join(projectDir, '.claude', 'commands'), { recursive: true })
    writeFileSync(
      join(projectDir, '.claude', 'commands', 'lint.md'),
      '---\ndescription: Lint\n---\n',
    )

    const projects = {
      get: (id: string) =>
        id === 'p1'
          ? { projectId: 'p1', path: projectDir, name: 't', repoIdentity: null }
          : null,
      touch: () => {},
    } as unknown as ProjectRegistry

    // Empty provider store → default model catalogs from listHarnessModels.
    const providers = {
      listBindings: () => [],
      getCredentialDecrypted: () => null,
      listCustomPlatforms: () => [],
    } as unknown as ProviderStore

    const res = await dispatchHarnessResourcesRpc(
      'harness.resources',
      { projectId: 'p1', harnessId: 'claude' },
      {
        client: client(['environment:read', 'workspace:read']),
        projects,
        providers,
        homeDir,
        probeModels: async () => [],
      },
    )
    expect(res?.error).toBeUndefined()
    const result = res?.result as {
      claude: {
        models: Array<{ id: string }>
        skills: Array<{ name: string }>
        commands: Array<{ name: string }>
      }
    }
    expect(result.claude.models.length).toBeGreaterThan(0)
    expect(result.claude.skills.some((s) => s.name === 'demo')).toBe(true)
    expect(result.claude.commands.some((c) => c.name === 'lint')).toBe(true)
  })

  it('harness.connect is an alias', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'hr-alias-'))
    const homeDir = mkdtempSync(join(tmpdir(), 'hr-alias-home-'))
    dirs.push(projectDir, homeDir)
    const projects = {
      get: () => ({ projectId: 'p1', path: projectDir, name: 't', repoIdentity: null }),
      touch: () => {},
    } as unknown as ProjectRegistry
    const providers = {
      listBindings: () => [],
      getCredentialDecrypted: () => null,
      listCustomPlatforms: () => [],
    } as unknown as ProviderStore

    const res = await dispatchHarnessResourcesRpc(
      'harness.connect',
      { projectId: 'p1' },
      {
        client: client(['environment:read', 'workspace:read']),
        projects,
        providers,
        homeDir,
        probeModels: async () => [],
      },
    )
    expect(res?.error).toBeUndefined()
    expect(res?.result).toHaveProperty('claude')
    expect(res?.result).toHaveProperty('codex')
  })

  it('reports the catalog the node harness serves, not the built-in slug table', async () => {
    // Reproduces the remote model list: with no provider credential the node
    // answered with hardcoded slugs, so the desktop showed models that had
    // nothing to do with this host's Claude credential.
    const projectDir = mkdtempSync(join(tmpdir(), 'hr-models-'))
    dirs.push(projectDir)
    const projects = {
      get: () => ({ projectId: 'p1', path: projectDir, name: 't', repoIdentity: null }),
      touch: () => {},
    } as unknown as ProjectRegistry
    const providers = {
      listBindings: () => [],
      getCredentialDecrypted: () => null,
      listCustomPlatforms: () => [],
    } as unknown as ProviderStore

    const probedIn: string[] = []
    const res = await dispatchHarnessResourcesRpc(
      'harness.resources',
      { projectId: 'p1', harnessId: 'claude' },
      {
        client: client(['environment:read', 'workspace:read']),
        projects,
        providers,
        probeModels: async (harnessId, cwd) => {
          probedIn.push(cwd)
          return harnessId === 'claude'
            ? [
                { id: 'default', name: 'Opus 5 1M', description: '' },
                { id: 'claude-fable-5[1m]', name: 'Fable 5', description: '' },
              ]
            : []
        },
      },
    )

    const result = res?.result as { claude: { models: Array<{ id: string }> } }
    expect(result.claude.models.map((m) => m.id)).toEqual(['default', 'claude-fable-5[1m]'])
    expect(probedIn).toEqual([projectDir])
  })

  it('keeps the built-in slug table when the harness cannot be probed', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'hr-models-fallback-'))
    dirs.push(projectDir)
    const projects = {
      get: () => ({ projectId: 'p1', path: projectDir, name: 't', repoIdentity: null }),
      touch: () => {},
    } as unknown as ProjectRegistry
    const providers = {
      listBindings: () => [],
      getCredentialDecrypted: () => null,
      listCustomPlatforms: () => [],
    } as unknown as ProviderStore

    const res = await dispatchHarnessResourcesRpc(
      'harness.resources',
      { projectId: 'p1', harnessId: 'claude' },
      {
        client: client(['environment:read', 'workspace:read']),
        projects,
        providers,
        probeModels: async () => [],
      },
    )

    const result = res?.result as { claude: { models: Array<{ id: string }> } }
    expect(result.claude.models.length).toBeGreaterThan(0)
  })

  it('prefers a bound provider credential catalog over probing', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'hr-models-provider-'))
    dirs.push(projectDir)
    const projects = {
      get: () => ({ projectId: 'p1', path: projectDir, name: 't', repoIdentity: null }),
      touch: () => {},
    } as unknown as ProjectRegistry

    const db = openNodeDatabase(join(projectDir, 'state.sqlite'))
    const providers = new ProviderStore(db, join(projectDir, 'provider-secrets.key'))
    providers.upsertCustomPlatform({
      id: 'custom:relay',
      brand: 'relay',
      name: 'Relay',
      plans: [
        {
          id: 'api',
          name: 'API',
          auth: 'api-key',
          baseUrl: 'https://relay.example',
          endpoints: [
            { id: 'anthropic', protocols: ['anthropic-messages'],
              models: [{ id: 'relay-opus', name: 'Relay Opus' }],
            },
          ],
        },
      ],
    })
    const cred = providers.createCredential({
      platformId: 'custom:relay',
      planId: 'api',
      name: 'relay',
      secret: 'sk-upstream-secret',
    })
    providers.setBinding({ consumer: 'chat:claude', credentialId: cred.id })

    let probeCalls = 0
    const res = await dispatchHarnessResourcesRpc(
      'harness.resources',
      { projectId: 'p1', harnessId: 'claude' },
      {
        client: client(['environment:read', 'workspace:read']),
        projects,
        providers,
        probeModels: async () => {
          probeCalls += 1
          return [{ id: 'default', name: 'Opus 5 1M', description: '' }]
        },
      },
    )
    db.close()

    const result = res?.result as { claude: { models: Array<{ id: string }> } }
    expect(result.claude.models.map((m) => m.id)).toEqual(['relay-opus'])
    expect(probeCalls).toBe(0)
  })

  it('exposes Chat Completions provider models only when the experiment is enabled', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'hr-models-openai-chat-'))
    dirs.push(projectDir)
    const projects = {
      get: () => ({ projectId: 'p1', path: projectDir, name: 't', repoIdentity: null }),
      touch: () => {},
    } as unknown as ProjectRegistry

    const db = openNodeDatabase(join(projectDir, 'state.sqlite'))
    const providers = new ProviderStore(db, join(projectDir, 'provider-secrets.key'))
    providers.upsertCustomPlatform({
      id: 'custom:relay',
      brand: 'relay',
      name: 'Relay',
      plans: [{
        id: 'api',
        name: 'API',
        auth: 'api-key',
        baseUrl: 'https://relay.example',
        endpoints: [{ id: 'openai', protocols: ['openai-chat'],
          models: [{ id: 'relay-chat', name: 'Relay Chat' }],
        }],
      }],
    })
    const cred = providers.createCredential({
      platformId: 'custom:relay',
      planId: 'api',
      name: 'relay',
      secret: 'sk-upstream-secret',
    })
    providers.setBinding({ consumer: 'chat:claude', credentialId: cred.id })

    const res = await dispatchHarnessResourcesRpc(
      'harness.resources',
      { projectId: 'p1', harnessId: 'claude' },
      {
        client: client(['environment:read', 'workspace:read']),
        projects,
        providers,
        experimentalClaudeOpenAiChatEnabled: true,
        probeModels: async () => [{ id: 'native', name: 'Native', description: '' }],
      },
    )
    db.close()

    const result = res?.result as { claude: { models: Array<{ id: string }> } }
    expect(result.claude.models.map((m) => m.id)).toEqual(['relay-chat'])
  })

  it('serves the Codex catalog the node probed instead of the built-in slug table', async () => {
    getNodeCodexModelCatalog.mockReset()
    getNodeCodexModelCatalog.mockResolvedValue([
      { id: 'gpt-5.5', name: 'GPT-5.5', description: '', isDefault: true },
    ])
    const projectDir = mkdtempSync(join(tmpdir(), 'hr-codex-live-'))
    dirs.push(projectDir)
    const projects = {
      get: () => ({ projectId: 'p1', path: projectDir, name: 't', repoIdentity: null }),
      touch: () => {},
    } as unknown as ProjectRegistry
    const providers = {
      listBindings: () => [],
      getCredentialDecrypted: () => null,
      listCustomPlatforms: () => [],
    } as unknown as ProviderStore

    const res = await dispatchHarnessResourcesRpc(
      'harness.resources',
      { projectId: 'p1', harnessId: 'codex' },
      {
        client: client(['environment:read', 'workspace:read']),
        projects,
        providers,
      },
    )

    const result = res?.result as { codex: { models: Array<{ id: string }> } }
    expect(result.codex.models.map((model) => model.id)).toEqual(['gpt-5.5'])
    expect(getNodeCodexModelCatalog).toHaveBeenCalled()
  })

  it('asks Codex to probe again when the model list is refreshed', async () => {
    getNodeCodexModelCatalog.mockReset()
    getNodeCodexModelCatalog.mockResolvedValue([
      { id: 'gpt-5.5', name: 'GPT-5.5', description: '', isDefault: true },
    ])
    const projectDir = mkdtempSync(join(tmpdir(), 'hr-codex-force-'))
    dirs.push(projectDir)
    const projects = {
      get: () => ({ projectId: 'p1', path: projectDir, name: 't', repoIdentity: null }),
      touch: () => {},
    } as unknown as ProjectRegistry
    const providers = {
      listBindings: () => [],
      getCredentialDecrypted: () => null,
      listCustomPlatforms: () => [],
    } as unknown as ProviderStore

    await dispatchHarnessResourcesRpc(
      'harness.resources',
      { projectId: 'p1', harnessId: 'codex', force: true },
      {
        client: client(['environment:read', 'workspace:read']),
        projects,
        providers,
      },
    )

    expect(getNodeCodexModelCatalog).toHaveBeenCalledWith(expect.objectContaining({ force: true }))
  })

  it('keeps the built-in Codex slug table when model/list returns nothing', async () => {
    getNodeCodexModelCatalog.mockReset()
    getNodeCodexModelCatalog.mockResolvedValue([])
    const projectDir = mkdtempSync(join(tmpdir(), 'hr-codex-fallback-'))
    dirs.push(projectDir)
    const projects = {
      get: () => ({ projectId: 'p1', path: projectDir, name: 't', repoIdentity: null }),
      touch: () => {},
    } as unknown as ProjectRegistry
    const providers = {
      listBindings: () => [],
      getCredentialDecrypted: () => null,
      listCustomPlatforms: () => [],
    } as unknown as ProviderStore

    const res = await dispatchHarnessResourcesRpc(
      'harness.resources',
      { projectId: 'p1', harnessId: 'codex' },
      {
        client: client(['environment:read', 'workspace:read']),
        projects,
        providers,
      },
    )

    const result = res?.result as { codex: { models: Array<{ id: string }> } }
    expect(result.codex.models.map((model) => model.id)).toEqual(['gpt-5.2', 'gpt-5.1', 'o3'])
  })

  it('keeps a bound Codex credential catalog and does not probe model/list', async () => {
    getNodeCodexModelCatalog.mockReset()
    const projectDir = mkdtempSync(join(tmpdir(), 'hr-codex-provider-'))
    dirs.push(projectDir)
    const projects = {
      get: () => ({ projectId: 'p1', path: projectDir, name: 't', repoIdentity: null }),
      touch: () => {},
    } as unknown as ProjectRegistry
    const db = openNodeDatabase(join(projectDir, 'state.sqlite'))
    const providers = new ProviderStore(db, join(projectDir, 'provider-secrets.key'))
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

    const res = await dispatchHarnessResourcesRpc(
      'harness.resources',
      { projectId: 'p1', harnessId: 'codex' },
      {
        client: client(['environment:read', 'workspace:read']),
        projects,
        providers,
      },
    )
    db.close()

    const result = res?.result as { codex: { models: Array<{ id: string }> } }
    expect(result.codex.models.map((model) => model.id)).toEqual(['relay-gpt'])
    expect(getNodeCodexModelCatalog).not.toHaveBeenCalled()
  })

  it('fills Claude account, slash commands and output styles from one probe', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'hr-claude-catalog-'))
    dirs.push(projectDir)
    const projects = {
      get: () => ({ projectId: 'p1', path: projectDir, name: 't', repoIdentity: null }),
      touch: () => {},
    } as unknown as ProjectRegistry
    const providers = {
      listBindings: () => [],
      getCredentialDecrypted: () => null,
      listCustomPlatforms: () => [],
    } as unknown as ProviderStore
    const probeClaudeCatalog = vi.fn(async () => ({
      models: [{ id: 'opus-live', name: 'Opus', description: '' }],
      account: { email: 'a@b.com', organization: 'Org', subscriptionType: 'max' },
      slashCommands: [{ name: 'review', description: 'Review', argumentHint: '', isSkill: false }],
      outputStyles: ['Explanatory'],
    }))

    const res = await dispatchHarnessResourcesRpc(
      'harness.resources',
      { projectId: 'p1', harnessId: 'claude' },
      {
        client: client(['environment:read', 'workspace:read']),
        projects,
        providers,
        probeClaudeCatalog,
      },
    )

    const result = res?.result as {
      claude: {
        models: Array<{ id: string }>
        account: { email?: string }
        slashCommands: Array<{ name: string }>
        outputStyles: string[]
      }
    }
    expect(result.claude.models.map((model) => model.id)).toEqual(['opus-live'])
    expect(result.claude.account).toMatchObject({ email: 'a@b.com', organization: 'Org', subscriptionType: 'max' })
    expect(result.claude.slashCommands).toEqual([
      { name: 'review', description: 'Review', argumentHint: '', isSkill: false },
    ])
    expect(result.claude.outputStyles).toEqual(['Explanatory'])
    expect(probeClaudeCatalog).toHaveBeenCalledTimes(1)
  })

  it('skips the Claude metadata probe when a test replaces the model probe', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'hr-claude-skip-'))
    dirs.push(projectDir)
    const projects = {
      get: () => ({ projectId: 'p1', path: projectDir, name: 't', repoIdentity: null }),
      touch: () => {},
    } as unknown as ProjectRegistry
    const providers = {
      listBindings: () => [],
      getCredentialDecrypted: () => null,
      listCustomPlatforms: () => [],
    } as unknown as ProviderStore
    const probeClaudeCatalog = vi.fn(async () => {
      throw new Error('should not probe')
    })

    const res = await dispatchHarnessResourcesRpc(
      'harness.resources',
      { projectId: 'p1', harnessId: 'claude' },
      {
        client: client(['environment:read', 'workspace:read']),
        projects,
        providers,
        probeModels: async () => [],
        probeClaudeCatalog,
      },
    )

    const result = res?.result as { claude: { models: Array<{ id: string }>; account: Record<string, unknown> } }
    expect(result.claude.models.some((model) => model.id === 'claude-opus-5-5')).toBe(true)
    expect(result.claude.account).toEqual({})
    expect(probeClaudeCatalog).not.toHaveBeenCalled()
  })

  it('requires projectId', async () => {
    const res = await dispatchHarnessResourcesRpc(
      'harness.resources',
      {},
      {
        client: client(['environment:read', 'workspace:read']),
        projects: { get: () => null, touch: () => {} } as unknown as ProjectRegistry,
        providers: {} as ProviderStore,
      },
    )
    expect(res?.error?.code).toBe('invalid_argument')
  })
})
