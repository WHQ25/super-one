/**
 * Node-local AI provider credentials + consumer bindings.
 * Secrets are encrypted at rest; list APIs return masked secrets.
 */

import { randomUUID } from 'node:crypto'
import type {
  BindingConfig,
  ConsumerBinding,
  ConsumerId,
  Credential,
  EndpointOverride,
  Platform,
  ServiceEndpoint,
} from '@superone/shared/platform-registry'
import type { NodeDatabase } from '../db/database'
import { createNodeSecretCrypto } from './secret-crypto'

function safeParse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function maskApiKey(secret: string): string {
  if (!secret) return ''
  if (secret.length <= 6) return '***'
  return `***${secret.slice(-6)}`
}

export interface CreateCredentialInput {
  id?: string
  platformId: string
  planId: string
  name: string
  secret?: string
  secretEnv?: string
  overrides?: Record<string, EndpointOverride>
  endpoints?: ServiceEndpoint[]
  notes?: string
}

export interface UpdateCredentialInput {
  name?: string
  secret?: string
  secretEnv?: string
  overrides?: Record<string, EndpointOverride>
  endpoints?: ServiceEndpoint[] | null
  notes?: string
  sortOrder?: number
}

/** Full secret bundle for push/pull over authenticated RPC. */
export interface ProviderBundle {
  credentials: Array<Credential & { secret: string }>
  bindings: ConsumerBinding[]
  customPlatforms: Platform[]
}

interface CredentialRow {
  id: string
  platform_id: string
  plan_id: string
  name: string
  secret: string
  secret_env: string
  overrides_json: string
  endpoints_json: string | null
  notes: string
  sort_order: number
}

interface BindingRow {
  consumer: string
  credential_id: string
  endpoint_id: string | null
  config_json: string
}

interface CustomPlatformRow {
  id: string
  definition_json: string
}

export class ProviderStore {
  private readonly crypto: ReturnType<typeof createNodeSecretCrypto>

  constructor(
    private readonly db: NodeDatabase,
    secretKeyPath: string,
  ) {
    this.crypto = createNodeSecretCrypto(secretKeyPath)
  }

  listCredentials(): Credential[] {
    return (this.db.prepare('SELECT * FROM provider_credentials ORDER BY sort_order, created_at').all() as CredentialRow[])
      .map((row) => this.rowToCredential(row))
      .map((c) => this.maskCredential(c))
  }

  getCredentialDecrypted(id: string): Credential | undefined {
    const row = this.getRow(id)
    if (!row) return undefined
    const c = this.rowToCredential(row)
    return { ...c, secret: this.crypto.decrypt(c.secret) }
  }

  createCredential(input: CreateCredentialInput): Credential {
    const now = new Date().toISOString()
    const id = input.id?.trim() || randomUUID()
    const maxOrder =
      (this.db.prepare('SELECT MAX(sort_order) as m FROM provider_credentials').get() as { m: number | null })
        ?.m ?? -1
    this.db
      .prepare(
        `INSERT INTO provider_credentials
          (id, platform_id, plan_id, name, secret, secret_env, overrides_json, endpoints_json, notes, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.platformId,
        input.planId,
        input.name,
        this.crypto.encrypt(input.secret ?? ''),
        input.secretEnv ?? '',
        JSON.stringify(input.overrides ?? {}),
        this.serializeEndpoints(input.endpoints),
        input.notes ?? '',
        maxOrder + 1,
        now,
        now,
      )
    return this.maskCredential(this.rowToCredential(this.getRow(id)!))
  }

  updateCredential(id: string, patch: UpdateCredentialInput): Credential | undefined {
    const existing = this.getRow(id)
    if (!existing) return undefined
    const skipSecret = patch.secret !== undefined && patch.secret.startsWith('***')
    const nextSecret = skipSecret
      ? existing.secret
      : this.crypto.encrypt(patch.secret ?? this.crypto.decrypt(existing.secret))
    const nextEndpoints =
      patch.endpoints !== undefined ? this.serializeEndpoints(patch.endpoints) : existing.endpoints_json
    this.db
      .prepare(
        `UPDATE provider_credentials SET
          name = ?, secret = ?, secret_env = ?, overrides_json = ?, endpoints_json = ?, notes = ?, sort_order = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.name ?? existing.name,
        nextSecret,
        patch.secretEnv ?? existing.secret_env,
        patch.overrides ? JSON.stringify(patch.overrides) : existing.overrides_json,
        nextEndpoints,
        patch.notes ?? existing.notes,
        patch.sortOrder ?? existing.sort_order,
        new Date().toISOString(),
        id,
      )
    return this.maskCredential(this.rowToCredential(this.getRow(id)!))
  }

  deleteCredential(id: string): boolean {
    const changed = this.db.prepare('DELETE FROM provider_credentials WHERE id = ?').run(id).changes > 0
    this.db.prepare('DELETE FROM provider_bindings WHERE credential_id = ?').run(id)
    return changed
  }

  listBindings(): ConsumerBinding[] {
    return (this.db.prepare('SELECT * FROM provider_bindings').all() as BindingRow[]).map((row) =>
      this.rowToBinding(row),
    )
  }

  setBinding(binding: ConsumerBinding): void {
    this.db
      .prepare(
        `INSERT INTO provider_bindings (consumer, credential_id, endpoint_id, config_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(consumer) DO UPDATE SET
           credential_id = excluded.credential_id,
           endpoint_id = excluded.endpoint_id,
           config_json = excluded.config_json`,
      )
      .run(
        binding.consumer,
        binding.credentialId,
        binding.endpointId ?? null,
        JSON.stringify(binding.config ?? {}),
      )
  }

  clearBinding(consumer: ConsumerId): void {
    this.db.prepare('DELETE FROM provider_bindings WHERE consumer = ?').run(consumer)
  }

  listCustomPlatforms(): Platform[] {
    return (this.db.prepare('SELECT id, definition_json FROM provider_custom_platforms').all() as CustomPlatformRow[])
      .map((row) => safeParse<Platform | null>(row.definition_json, null))
      .filter((p): p is Platform => !!p)
  }

  upsertCustomPlatform(def: Platform): Platform {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO provider_custom_platforms (id, definition_json, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET definition_json = excluded.definition_json, updated_at = excluded.updated_at`,
      )
      .run(def.id, JSON.stringify(def), now, now)
    return def
  }

  deleteCustomPlatform(id: string): boolean {
    const changed =
      this.db.prepare('DELETE FROM provider_custom_platforms WHERE id = ?').run(id).changes > 0
    const creds = this.db
      .prepare('SELECT id FROM provider_credentials WHERE platform_id = ?')
      .all(id) as Array<{ id: string }>
    for (const c of creds) this.deleteCredential(c.id)
    return changed
  }

  /** Export plaintext secrets for authenticated admin pull. */
  exportBundle(): ProviderBundle {
    const rows = this.db.prepare('SELECT * FROM provider_credentials ORDER BY sort_order').all() as CredentialRow[]
    const credentials = rows.map((row) => {
      const c = this.rowToCredential(row)
      return { ...c, secret: this.crypto.decrypt(c.secret) }
    })
    return {
      credentials,
      bindings: this.listBindings(),
      customPlatforms: this.listCustomPlatforms(),
    }
  }

  /**
   * Import a desktop (or other node) bundle. Replaces by id; does not delete
   * local-only credentials unless `replaceAll` is true.
   */
  importBundle(bundle: ProviderBundle, opts?: { replaceAll?: boolean }): { credentials: number; bindings: number } {
    if (opts?.replaceAll) {
      this.db.exec('DELETE FROM provider_bindings')
      this.db.exec('DELETE FROM provider_credentials')
      this.db.exec('DELETE FROM provider_custom_platforms')
    }
    for (const plat of bundle.customPlatforms ?? []) {
      if (plat?.id) this.upsertCustomPlatform(plat)
    }
    let creds = 0
    for (const c of bundle.credentials ?? []) {
      if (!c?.id || !c.platformId || !c.planId || !c.name) continue
      const existing = this.getRow(c.id)
      if (existing) {
        this.updateCredential(c.id, {
          name: c.name,
          secret: c.secret,
          secretEnv: c.secretEnv,
          overrides: c.overrides,
          endpoints: c.endpoints ?? null,
          notes: c.notes,
          sortOrder: c.sortOrder,
        })
      } else {
        this.createCredential({
          id: c.id,
          platformId: c.platformId,
          planId: c.planId,
          name: c.name,
          secret: c.secret,
          secretEnv: c.secretEnv,
          overrides: c.overrides,
          endpoints: c.endpoints,
          notes: c.notes,
        })
      }
      creds += 1
    }
    let binds = 0
    for (const b of bundle.bindings ?? []) {
      if (!b?.consumer || !b.credentialId) continue
      this.setBinding(b)
      binds += 1
    }
    return { credentials: creds, bindings: binds }
  }

  private getRow(id: string): CredentialRow | undefined {
    return this.db.prepare('SELECT * FROM provider_credentials WHERE id = ?').get(id) as
      | CredentialRow
      | undefined
  }

  private rowToCredential(row: CredentialRow): Credential {
    const endpoints = safeParse<ServiceEndpoint[] | null>(row.endpoints_json, null)
    return {
      id: row.id,
      platformId: row.platform_id,
      planId: row.plan_id,
      name: row.name,
      secret: row.secret,
      secretEnv: row.secret_env || undefined,
      overrides: safeParse<Record<string, EndpointOverride>>(row.overrides_json, {}),
      endpoints: endpoints && endpoints.length > 0 ? endpoints : undefined,
      notes: row.notes,
      sortOrder: row.sort_order,
    }
  }

  private maskCredential(cred: Credential): Credential {
    return { ...cred, secret: maskApiKey(this.crypto.decrypt(cred.secret)) }
  }

  private rowToBinding(row: BindingRow): ConsumerBinding {
    return {
      consumer: row.consumer as ConsumerId,
      credentialId: row.credential_id,
      endpointId: row.endpoint_id ?? undefined,
      config: safeParse<BindingConfig>(row.config_json, {}),
    }
  }

  private serializeEndpoints(endpoints: ServiceEndpoint[] | null | undefined): string | null {
    if (endpoints === null) return null
    if (!endpoints || endpoints.length === 0) return null
    return JSON.stringify(endpoints)
  }
}
