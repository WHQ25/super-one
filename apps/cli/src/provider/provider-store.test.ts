import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openNodeDatabase } from '../db/database'
import { ProviderStore } from './provider-store'

describe('ProviderStore', () => {
  let dir: string
  let store: ProviderStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'prov-store-'))
    const db = openNodeDatabase(join(dir, 'state.sqlite'))
    store = new ProviderStore(db, join(dir, 'provider-secrets.key'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates and lists masked credentials', () => {
    const created = store.createCredential({
      platformId: 'openai',
      planId: 'api',
      name: 'work',
      secret: 'sk-test-secret-value-123456',
    })
    expect(created.secret.startsWith('***')).toBe(true)
    expect(created.secret.endsWith('123456')).toBe(true)
    const listed = store.listCredentials()
    expect(listed).toHaveLength(1)
    expect(listed[0]!.id).toBe(created.id)
  })

  it('exports and imports a bundle round-trip', () => {
    const a = store.createCredential({
      platformId: 'openai',
      planId: 'api',
      name: 'a',
      secret: 'secret-aaa-111111',
    })
    store.setBinding({ consumer: 'chat:claude', credentialId: a.id })

    const bundle = store.exportBundle()
    expect(bundle.credentials[0]!.secret).toBe('secret-aaa-111111')

    const dir2 = mkdtempSync(join(tmpdir(), 'prov-store-2-'))
    try {
      const db2 = openNodeDatabase(join(dir2, 'state.sqlite'))
      const store2 = new ProviderStore(db2, join(dir2, 'provider-secrets.key'))
      const stats = store2.importBundle(bundle, { replaceAll: true })
      expect(stats.credentials).toBe(1)
      expect(stats.bindings).toBe(1)
      const exported = store2.exportBundle()
      expect(exported.credentials[0]!.secret).toBe('secret-aaa-111111')
      expect(exported.bindings[0]!.consumer).toBe('chat:claude')
    } finally {
      rmSync(dir2, { recursive: true, force: true })
    }
  })
})
