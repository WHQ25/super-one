import { afterEach, describe, expect, it } from 'vitest'
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
      'harness.connect',
      { projectId: 'p1' },
      {
        client: client(['environment:read', 'workspace:read']),
        projects,
        providers,
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
          endpoints: [
            {
              id: 'anthropic',
              baseUrl: 'https://relay.example',
              protocols: ['anthropic-messages'],
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
        endpoints: [{
          id: 'openai',
          baseUrl: 'https://relay.example/v1',
          protocols: ['openai-chat'],
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
