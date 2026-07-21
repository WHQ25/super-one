import type { Credential, EndpointOverride, Platform } from '@superone/shared/platform-registry'
import {
  createCredential,
  deleteCredential,
  deleteCustomPlatform,
  listCredentials,
  listCustomPlatforms,
  updateCredential,
  upsertCustomPlatform,
  type UpdateCredentialInput,
} from '../providers/credential-store'

export type ResourceFieldType = 'boolean' | 'enum' | 'number' | 'string' | 'json'
// 'json' = structured value (e.g. a credential's endpoint overrides, a platform's plans). In the UI
// it's edited as pretty-printed JSON text, same ConfigValue = string|number|boolean|null contract
// every other field type already uses. Parsing to a real object happens in config-tools.ts's
// resource-apply branch, not here — this file only deals in already-typed values from a direct
// tool call, or already-parsed values handed in from that branch after a confirm round-trip.

export interface ResourceFieldDef {
  key: string
  label: string
  type: ResourceFieldType
  enumValues?: readonly string[]
  required?: boolean
  note?: string
}

export interface ResourceDef<TRecord = unknown> {
  resource: string
  label: string
  description: string
  /** Default true. Set false for resources that aren't scoped to the session's active project (e.g. AI provider credentials). */
  projectScoped?: boolean
  fields: ResourceFieldDef[]
  identifyBy: (record: TRecord) => { title: string; subtitle?: string }
  list: (projectPath: string) => TRecord[]
  toRecordSummary: (record: TRecord) => Record<string, unknown>
  create: (projectPath: string, values: Record<string, unknown>) => TRecord
  update: (id: string, values: Record<string, unknown>) => TRecord | undefined
  delete: (id: string) => boolean
}

function requireString(values: Record<string, unknown>, key: string): string {
  const v = values[key]
  if (typeof v !== 'string' || v.length === 0) throw new Error(`\`${key}\` is required and must be a non-empty string`)
  return v
}

function requireObject(values: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = values[key]
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`\`${key}\` is required and must be an object`)
  return v as Record<string, unknown>
}

function requireArray(values: Record<string, unknown>, key: string): unknown[] {
  const v = values[key]
  if (!Array.isArray(v)) throw new Error(`\`${key}\` is required and must be an array`)
  return v
}

function optionalString(values: Record<string, unknown>, key: string): string | undefined {
  const v = values[key]
  return typeof v === 'string' ? v : undefined
}

const credentialResourceDef: ResourceDef<Credential> = {
  resource: 'ai-provider',
  label: 'AI Provider',
  description: 'API keys and credentials bound to an AI provider platform + plan (Settings → AI Provider). The `secret` field is masked on read as "***last6" — propose a new value to replace it, or leave the masked value unchanged to keep the existing secret.',
  projectScoped: false,
  fields: [
    { key: 'platformId', label: 'Platform', type: 'string', required: true, note: 'Id of a built-in or custom platform, e.g. "zhipu-cn" or "custom:<uuid>".' },
    { key: 'planId', label: 'Plan', type: 'string', required: true },
    { key: 'name', label: 'Name', type: 'string', required: true, note: 'Key label, unique within the platform.' },
    { key: 'secret', label: 'Secret / API Key', type: 'string', note: 'Masked on read as "***last6". Provide a new value to replace it; omit or leave the masked value to keep it unchanged.' },
    { key: 'secretEnv', label: 'Secret Env Var', type: 'string', note: 'Read the key from this environment variable instead of the stored secret.' },
    { key: 'overrides', label: 'Endpoint Overrides', type: 'json', note: 'Per-endpoint overrides: { [endpointId]: { baseUrl?, models?, extraEnv?, modelMapping? } }' },
    { key: 'notes', label: 'Notes', type: 'string' },
  ],
  identifyBy: (record) => ({ title: record.name, subtitle: `${record.platformId} / ${record.planId}` }),
  list: () => listCredentials(),
  toRecordSummary: (record) => ({ ...record }),
  create: (_projectPath, values) =>
    createCredential({
      platformId: requireString(values, 'platformId'),
      planId: requireString(values, 'planId'),
      name: requireString(values, 'name'),
      secret: optionalString(values, 'secret'),
      secretEnv: optionalString(values, 'secretEnv'),
      overrides: 'overrides' in values ? (requireObject(values, 'overrides') as Record<string, EndpointOverride>) : undefined,
      notes: optionalString(values, 'notes'),
    }),
  update: (id, values) => {
    const patch: UpdateCredentialInput = {}
    if ('name' in values) patch.name = requireString(values, 'name')
    if ('secret' in values) patch.secret = optionalString(values, 'secret')
    if ('secretEnv' in values) patch.secretEnv = optionalString(values, 'secretEnv')
    if ('overrides' in values) patch.overrides = requireObject(values, 'overrides') as Record<string, EndpointOverride>
    if ('notes' in values) patch.notes = optionalString(values, 'notes')
    return updateCredential(id, patch)
  },
  delete: (id) => deleteCredential(id),
}

const customPlatformResourceDef: ResourceDef<Platform> = {
  resource: 'custom-platform',
  label: 'Custom Provider',
  description: 'User-defined AI provider platform definitions — brand, plans, endpoints, models (Settings → AI Provider). Deleting a platform cascades to its credentials.',
  projectScoped: false,
  fields: [
    { key: 'id', label: 'Id', type: 'string', required: true, note: 'Must start with "custom:", e.g. "custom:my-provider".' },
    { key: 'brand', label: 'Brand', type: 'string', required: true, note: 'Icon + display grouping only.' },
    { key: 'name', label: 'Name', type: 'string', required: true },
    { key: 'description', label: 'Description', type: 'string' },
    { key: 'catalogProviderId', label: 'Catalog Provider Id', type: 'string' },
    { key: 'plans', label: 'Plans', type: 'json', required: true, note: 'Plan[] — see config_read_guide for the shape (id, name, auth, endpoints[]).' },
  ],
  identifyBy: (record) => ({ title: record.name, subtitle: record.brand }),
  list: () => listCustomPlatforms(),
  toRecordSummary: (record) => ({ ...record }),
  create: (_projectPath, values) => {
    const id = requireString(values, 'id')
    if (!id.startsWith('custom:')) throw new Error('`id` must start with "custom:"')
    return upsertCustomPlatform({
      id,
      brand: requireString(values, 'brand'),
      name: requireString(values, 'name'),
      description: optionalString(values, 'description'),
      catalogProviderId: optionalString(values, 'catalogProviderId'),
      plans: requireArray(values, 'plans') as Platform['plans'],
    })
  },
  update: (id, values) => {
    const existing = listCustomPlatforms().find((p) => p.id === id)
    if (!existing) return undefined
    return upsertCustomPlatform({
      ...existing,
      ...('brand' in values ? { brand: requireString(values, 'brand') } : {}),
      ...('name' in values ? { name: requireString(values, 'name') } : {}),
      ...('description' in values ? { description: optionalString(values, 'description') } : {}),
      ...('catalogProviderId' in values ? { catalogProviderId: optionalString(values, 'catalogProviderId') } : {}),
      ...('plans' in values ? { plans: requireArray(values, 'plans') as Platform['plans'] } : {}),
    })
  },
  delete: (id) => deleteCustomPlatform(id),
}

export const RESOURCE_DEFS: ResourceDef[] = [
  credentialResourceDef as ResourceDef,
  customPlatformResourceDef as ResourceDef,
]

export function findResourceDef(resource: string): ResourceDef | null {
  return RESOURCE_DEFS.find((r) => r.resource === resource) ?? null
}

export function listResourceSummaries(): Array<{ domain: string; label: string; description: string; fieldCount: number }> {
  return RESOURCE_DEFS.map((r) => ({ domain: r.resource, label: r.label, description: r.description, fieldCount: r.fields.length }))
}
