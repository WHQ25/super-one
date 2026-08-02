import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openNodeDatabase } from '../db/database'
import { ProviderStore } from './provider-store'
import {
  buildHarnessEnv,
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
})
