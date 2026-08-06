import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openNodeDatabase } from '../db/database'
import { ProviderStore } from './provider-store'
import { shutdownAll as shutdownAllProxies } from '@superone/runtime/llm-proxy'
import {
  buildHarnessEnv,
  buildHarnessEnvWithProxy,
  listHarnessApiProviders,
  listHarnessModels,
  resolveHarnessService,
} from './resolve-service'

describe('resolve-service', () => {
  let dir: string
  let store: ProviderStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'resolve-svc-'))
    const db = openNodeDatabase(join(dir, 'state.sqlite'))
    store = new ProviderStore(db, join(dir, 'provider-secrets.key'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns default Claude models when no credential is bound', () => {
    const models = listHarnessModels(store, 'claude', null)
    expect(models.length).toBeGreaterThan(0)
    expect(models.some((m) => m.isDefault)).toBe(true)
  })

  it('returns default Codex models when no credential is bound', () => {
    const models = listHarnessModels(store, 'codex', null)
    expect(models.map((m) => m.id)).toContain('gpt-5.2')
  })

  it('resolves harness service from binding and builds Claude env', () => {
    const cred = store.createCredential({
      platformId: 'anthropic',
      planId: 'api',
      name: 'work',
      secret: 'sk-ant-test-secret-abcdef',
    })
    store.setBinding({ consumer: 'chat:claude', credentialId: cred.id })

    const resolved = resolveHarnessService(store, 'claude', null)
    expect(resolved).not.toBeNull()
    expect(resolved!.credentialId).toBe(cred.id)
    expect(resolved!.apiKey).toBe('sk-ant-test-secret-abcdef')

    const env = buildHarnessEnv('claude', resolved)
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test-secret-abcdef')
  })

  it('prefers explicit apiProviderId over consumer binding', () => {
    const bound = store.createCredential({
      platformId: 'anthropic',
      planId: 'api',
      name: 'bound',
      secret: 'sk-bound-111111',
    })
    const other = store.createCredential({
      platformId: 'anthropic',
      planId: 'api',
      name: 'other',
      secret: 'sk-other-222222',
    })
    store.setBinding({ consumer: 'chat:claude', credentialId: bound.id })

    const resolved = resolveHarnessService(store, 'claude', other.id)
    expect(resolved?.credentialId).toBe(other.id)
    expect(resolved?.apiKey).toBe('sk-other-222222')
  })

  it('buildHarnessEnv sets Codex keys', () => {
    const cred = store.createCredential({
      platformId: 'openai',
      planId: 'api',
      name: 'oai',
      secret: 'sk-openai-333333',
    })
    store.setBinding({ consumer: 'chat:codex', credentialId: cred.id })
    const resolved = resolveHarnessService(store, 'codex', null)
    const env = buildHarnessEnv('codex', resolved)
    expect(env.OPENAI_API_KEY).toBe('sk-openai-333333')
    expect(env.CODEX_API_KEY).toBe('sk-openai-333333')
  })

  it('listHarnessModels returns empty for unknown harness', () => {
    expect(listHarnessModels(store, 'acp', null)).toEqual([])
  })

  it('listHarnessApiProviders returns endpoint-capable credentials for the harness', () => {
    const anthropic = store.createCredential({
      platformId: 'anthropic',
      planId: 'api',
      name: 'ant-key',
      secret: 'sk-ant-list-abcdef',
    })
    const openai = store.createCredential({
      platformId: 'openai',
      planId: 'api',
      name: 'oai-key',
      secret: 'sk-oai-list-abcdef',
    })
    const claudeProviders = listHarnessApiProviders(store, 'claude')
    const codexProviders = listHarnessApiProviders(store, 'codex')
    expect(claudeProviders.some((p) => p.id === anthropic.id && p.keyName === 'ant-key')).toBe(true)
    expect(codexProviders.some((p) => p.id === openai.id && p.brand === 'openai')).toBe(true)
    expect(listHarnessApiProviders(store, 'acp')).toEqual([])
  })

  it('resolves openai-chat custom platform for Claude and Codex', () => {
    store.upsertCustomPlatform({
      id: 'custom:relay',
      brand: 'relay',
      name: 'Relay',
      plans: [
        {
          id: 'api',
          name: 'API',
          auth: 'api-key',
          endpoints: [{ id: 'openai', baseUrl: 'https://relay.example/v1', protocols: ['openai-chat'] }],
        },
      ],
    })
    const cred = store.createCredential({
      platformId: 'custom:relay',
      planId: 'api',
      name: 'relay-key',
      secret: 'sk-relay-secret-999999',
    })
    store.setBinding({ consumer: 'chat:claude', credentialId: cred.id })
    store.setBinding({ consumer: 'chat:codex', credentialId: cred.id })

    const claude = resolveHarnessService(store, 'claude', null)
    expect(claude?.protocol).toBe('openai-chat')
    expect(claude?.baseUrl).toMatch(/relay\.example/)

    const codex = resolveHarnessService(store, 'codex', null)
    expect(codex?.protocol).toBe('openai-chat')
  })
})

describe('buildHarnessEnvWithProxy', () => {
  afterEach(async () => {
    await shutdownAllProxies()
  })

  it('points Claude env at loopback proxy for openai-chat credentials', async () => {
    const env = await buildHarnessEnvWithProxy('claude', {
      platformId: 'custom:relay',
      brand: 'relay',
      planId: 'api',
      endpointId: 'openai',
      credentialId: 'c1',
      task: 'chat',
      protocol: 'openai-chat',
      baseUrl: 'https://relay.example/v1',
      apiKey: 'sk-upstream-secret',
      auth: 'api-key',
      models: [{ id: 'm1' }],
    })
    expect(env.ANTHROPIC_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(env.ANTHROPIC_API_KEY).toBe('sk-superone-proxy')
    const health = await fetch(`${env.ANTHROPIC_BASE_URL}/health`)
    expect(health.ok).toBe(true)
  })

  it('points Codex env at loopback proxy for openai-chat credentials', async () => {
    const env = await buildHarnessEnvWithProxy('codex', {
      platformId: 'custom:relay',
      brand: 'relay',
      planId: 'api',
      endpointId: 'openai',
      credentialId: 'c1',
      task: 'chat',
      protocol: 'openai-chat',
      baseUrl: 'https://relay.example/v1',
      apiKey: 'sk-upstream-secret',
      auth: 'api-key',
    })
    expect(env.OPENAI_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(env.CODEX_BASE_URL).toBe(env.OPENAI_BASE_URL)
    expect(env.CODEX_API_KEY).toBe('sk-superone-proxy')
  })

  it('leaves native anthropic-messages base URL unchanged', async () => {
    const env = await buildHarnessEnvWithProxy('claude', {
      platformId: 'anthropic',
      brand: 'anthropic',
      planId: 'api',
      endpointId: 'anthropic',
      credentialId: 'c1',
      task: 'chat',
      protocol: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-native',
      auth: 'api-key',
    })
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-native')
  })

  it('leaves native openai-responses base URL unchanged for Codex', async () => {
    const env = await buildHarnessEnvWithProxy('codex', {
      platformId: 'openai',
      brand: 'openai',
      planId: 'api',
      endpointId: 'responses',
      credentialId: 'c1',
      task: 'chat',
      protocol: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai-native',
      auth: 'api-key',
    })
    expect(env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1')
    expect(env.CODEX_BASE_URL).toBe('https://api.openai.com/v1')
    expect(env.CODEX_API_KEY).toBe('sk-openai-native')
    expect(env.CODEX_API_KEY).not.toBe('sk-superone-proxy')
  })
})
