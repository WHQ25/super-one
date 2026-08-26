import { randomUUID } from 'crypto'
import type {
  BindingConfig,
  ConsumerBinding,
  ConsumerId,
  Credential,
  EndpointOverride,
  Platform,
  ServiceEndpoint,
} from '@superone/shared/platform-registry'
import { getDb, maskApiKey } from '../database'
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../crypto/secret-store'

function safeParse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

// --- credentials -------------------------------------------------------------

interface CredentialRow {
  id: string
  platform_id: string
  plan_id: string
  name: string
  secret: string
  secret_env: string
  base_url: string
  overrides_json: string
  endpoints_json?: string | null
  notes: string
  sort_order: number
}

function rowToCredential(row: CredentialRow): Credential {
  const endpoints = safeParse<ServiceEndpoint[] | null>(row.endpoints_json ?? null, null)
  return {
    id: row.id,
    platformId: row.platform_id,
    planId: row.plan_id,
    name: row.name,
    secret: row.secret,
    secretEnv: row.secret_env || undefined,
    baseUrl: row.base_url || undefined,
    overrides: safeParse<Record<string, EndpointOverride>>(row.overrides_json, {}),
    endpoints: endpoints && endpoints.length > 0 ? endpoints : undefined,
    notes: row.notes,
    sortOrder: row.sort_order,
  }
}

/** Masked view for the renderer: the secret becomes `***last6`, never the plaintext. */
function maskCredential(cred: Credential): Credential {
  return { ...cred, secret: maskApiKey(decryptSecret(cred.secret)) }
}

export interface CreateCredentialInput {
  /** Optional stable id (e.g. when importing from a remote node). */
  id?: string
  platformId: string
  planId: string
  name: string
  secret?: string
  secretEnv?: string
  baseUrl?: string
  overrides?: Record<string, EndpointOverride>
  /** Custom platforms: full per-key endpoint list. */
  endpoints?: ServiceEndpoint[]
  notes?: string
}

export interface UpdateCredentialInput {
  name?: string
  secret?: string
  secretEnv?: string
  baseUrl?: string
  overrides?: Record<string, EndpointOverride>
  endpoints?: ServiceEndpoint[] | null
  notes?: string
  sortOrder?: number
}

function getCredentialRow(id: string): CredentialRow | undefined {
  return getDb().prepare('SELECT * FROM credentials WHERE id = ?').get(id) as CredentialRow | undefined
}

export function listCredentials(): Credential[] {
  return (getDb().prepare('SELECT * FROM credentials ORDER BY sort_order, created_at').all() as CredentialRow[])
    .map(rowToCredential)
    .map(maskCredential)
}

/** Main-only: credential with its secret decrypted for backend injection. Never send to the renderer. */
export function getCredentialDecrypted(id: string): Credential | undefined {
  const row = getCredentialRow(id)
  if (!row) return undefined
  const cred = rowToCredential(row)
  return { ...cred, secret: decryptSecret(cred.secret) }
}

function serializeEndpoints(endpoints: ServiceEndpoint[] | null | undefined): string | null {
  if (endpoints === null) return null
  if (!endpoints || endpoints.length === 0) return null
  return JSON.stringify(endpoints)
}

export function createCredential(input: CreateCredentialInput): Credential {
  const now = new Date().toISOString()
  const id = input.id?.trim() || randomUUID()
  const maxOrder =
    (getDb().prepare('SELECT MAX(sort_order) as m FROM credentials').get() as { m: number | null })?.m ?? -1
  getDb()
    .prepare(
      `INSERT INTO credentials
        (id, platform_id, plan_id, name, secret, secret_env, base_url, overrides_json, endpoints_json, notes, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.platformId,
      input.planId,
      input.name,
      encryptSecret(input.secret ?? ''),
      input.secretEnv ?? '',
      input.baseUrl ?? '',
      JSON.stringify(input.overrides ?? {}),
      serializeEndpoints(input.endpoints),
      input.notes ?? '',
      maxOrder + 1,
      now,
      now,
    )
  return maskCredential(rowToCredential(getCredentialRow(id)!))
}

export function updateCredential(id: string, patch: UpdateCredentialInput): Credential | undefined {
  const existing = getCredentialRow(id)
  if (!existing) return undefined
  // A masked secret (starts with '***') means "unchanged" — never overwrite the stored value with the mask.
  const skipSecret = patch.secret !== undefined && patch.secret.startsWith('***')
  const nextSecret = skipSecret
    ? existing.secret
    : encryptSecret(patch.secret ?? decryptSecret(existing.secret))
  const nextEndpoints =
    patch.endpoints !== undefined ? serializeEndpoints(patch.endpoints) : existing.endpoints_json
  getDb()
    .prepare(
      `UPDATE credentials SET
        name = ?, secret = ?, secret_env = ?, base_url = ?, overrides_json = ?, endpoints_json = ?, notes = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.name ?? existing.name,
      nextSecret,
      patch.secretEnv ?? existing.secret_env,
      patch.baseUrl ?? existing.base_url,
      patch.overrides ? JSON.stringify(patch.overrides) : existing.overrides_json,
      nextEndpoints,
      patch.notes ?? existing.notes,
      patch.sortOrder ?? existing.sort_order,
      new Date().toISOString(),
      id,
    )
  return maskCredential(rowToCredential(getCredentialRow(id)!))
}

export function deleteCredential(id: string): boolean {
  const db = getDb()
  const changed = db.prepare('DELETE FROM credentials WHERE id = ?').run(id).changes > 0
  // Bindings pointing at a deleted credential fall back to nothing; drop the dangling rows.
  db.prepare('DELETE FROM consumer_bindings WHERE credential_id = ?').run(id)
  return changed
}

export function listCredentialsForPlatform(platformId: string): Credential[] {
  return listCredentials().filter((c) => c.platformId === platformId)
}

export { isEncryptedSecret }

// --- custom platforms --------------------------------------------------------

interface CustomPlatformRow {
  id: string
  definition_json: string
}

export function listCustomPlatforms(): Platform[] {
  return (getDb().prepare('SELECT id, definition_json FROM custom_platforms').all() as CustomPlatformRow[])
    .map((row) => safeParse<Platform | null>(row.definition_json, null))
    .filter((p): p is Platform => !!p)
}

export function upsertCustomPlatform(def: Platform): Platform {
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO custom_platforms (id, definition_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET definition_json = excluded.definition_json, updated_at = excluded.updated_at`,
    )
    .run(def.id, JSON.stringify(def), now, now)
  return def
}

export function deleteCustomPlatform(id: string): boolean {
  const db = getDb()
  const changed = db.prepare('DELETE FROM custom_platforms WHERE id = ?').run(id).changes > 0
  // Cascade: drop this platform's credentials (and their bindings).
  const creds = db.prepare('SELECT id FROM credentials WHERE platform_id = ?').all(id) as Array<{ id: string }>
  for (const c of creds) deleteCredential(c.id)
  return changed
}

// --- consumer bindings -------------------------------------------------------

interface BindingRow {
  consumer: string
  credential_id: string
  endpoint_id: string | null
  config_json: string
}

function rowToBinding(row: BindingRow): ConsumerBinding {
  return {
    consumer: row.consumer as ConsumerId,
    credentialId: row.credential_id,
    endpointId: row.endpoint_id ?? undefined,
    config: safeParse<BindingConfig>(row.config_json, {}),
  }
}

export function listBindings(): ConsumerBinding[] {
  return (getDb().prepare('SELECT * FROM consumer_bindings').all() as BindingRow[]).map(rowToBinding)
}

export function getBinding(consumer: ConsumerId): ConsumerBinding | undefined {
  const row = getDb().prepare('SELECT * FROM consumer_bindings WHERE consumer = ?').get(consumer) as
    | BindingRow
    | undefined
  return row ? rowToBinding(row) : undefined
}

export function setBinding(binding: ConsumerBinding): void {
  getDb()
    .prepare(
      `INSERT INTO consumer_bindings (consumer, credential_id, endpoint_id, config_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(consumer) DO UPDATE SET
         credential_id = excluded.credential_id,
         endpoint_id = excluded.endpoint_id,
         config_json = excluded.config_json`,
    )
    .run(binding.consumer, binding.credentialId, binding.endpointId ?? null, JSON.stringify(binding.config ?? {}))
}

export function deleteBinding(consumer: ConsumerId): void {
  getDb().prepare('DELETE FROM consumer_bindings WHERE consumer = ?').run(consumer)
}
