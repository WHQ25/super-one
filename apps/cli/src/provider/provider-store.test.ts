import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openNodeDatabase } from '../db/database'
import { ProviderStore } from './provider-store'
import { endpointBaseUrl } from '@superone/shared/platform-registry'

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

  // The site root moved off each endpoint onto the key. It only works if it actually reaches SQL —
  // a field present on the input type but absent from the INSERT reads back as undefined forever.
  it('persists a per-key site root across create, read, and update', () => {
    const created = store.createCredential({
      platformId: 'custom:relay',
      planId: 'api',
      name: 'relay',
      secret: 'sk-relay-000000',
      baseUrl: 'https://relay.example',
    })
    expect(created.baseUrl).toBe('https://relay.example')
    expect(store.listCredentials()[0]!.baseUrl).toBe('https://relay.example')

    store.updateCredential(created.id, { baseUrl: 'https://other.example' })
    expect(store.listCredentials()[0]!.baseUrl).toBe('https://other.example')

    // A patch that does not mention baseUrl must not wipe it.
    store.updateCredential(created.id, { name: 'renamed' })
    expect(store.listCredentials()[0]!.baseUrl).toBe('https://other.example')
  })

  // The node database has to run the same endpoint conversion the desktop does, or a paired pair
  // resolves two different addresses from the same config.
  it('converts legacy endpoint base URLs to routes when the database opens', () => {
    const legacy = {
      id: 'custom:legacy',
      brand: 'custom',
      name: 'Legacy',
      plans: [
        {
          id: 'api',
          name: 'API',
          auth: 'api-key',
          endpoints: [
            { id: 'openai', baseUrl: 'https://relay.example/v1', protocols: ['openai-chat'] },
            { id: 'anthropic', baseUrl: 'https://relay.example', protocols: ['anthropic-messages'] },
          ],
        },
      ],
    }
    const dbPath = join(dir, 'legacy.sqlite')
    const seed = openNodeDatabase(dbPath)
    seed
      .prepare(
        `INSERT INTO provider_custom_platforms (id, definition_json, created_at, updated_at) VALUES (?, ?, '', '')`,
      )
      .run(legacy.id, JSON.stringify(legacy))
    seed.close()

    // Reopening runs the migration.
    const migrated = openNodeDatabase(dbPath)
    const row = migrated
      .prepare(`SELECT definition_json FROM provider_custom_platforms WHERE id = ?`)
      .get(legacy.id) as { definition_json: string }
    const plan = JSON.parse(row.definition_json).plans[0]
    migrated.close()

    expect(plan.baseUrl).toBe('https://relay.example')
    expect(plan.endpoints.map((e: { baseUrl?: string }) => e.baseUrl)).toEqual([undefined, undefined])
    expect(endpointBaseUrl(plan.baseUrl, plan.endpoints[0], 'openai-chat')).toBe('https://relay.example/v1')
    expect(endpointBaseUrl(plan.baseUrl, plan.endpoints[1], 'anthropic-messages')).toBe('https://relay.example')
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
