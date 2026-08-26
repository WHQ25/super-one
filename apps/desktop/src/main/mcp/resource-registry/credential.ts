import type { ConfigFieldContext, ProviderModelEnv } from '@superone/shared/agent-types'
import {
  CAPABILITY_ORDER,
  findPlan,
  findPlatform,
  type CapabilityTask,
  type Credential,
  type EndpointModel,
  type EndpointOverride,
} from '@superone/shared/platform-registry'
import {
  createCredential,
  deleteCredential,
  listCredentials,
  updateCredential,
  type UpdateCredentialInput,
} from '../../providers/credential-store'
import { getPlatforms } from '../../providers/registry'
import { asArray, asRecord, mergeMap, optionalString, requireString, type ResourceDef } from './types'

/** Fields that live inside `overrides[endpointId]` rather than on the credential row itself. */
const OVERRIDE_FIELDS = ['endpointBaseUrl', 'routes', 'models', 'modelMapping', 'extraEnv'] as const

function planEndpointIds(platformId: string | undefined, planId: string | undefined): string[] {
  if (!platformId || !planId) return []
  const plan = findPlan(findPlatform(getPlatforms(), platformId), planId)
  return plan?.endpoints.map((e) => e.id) ?? []
}

function requireEndpointId(ctx: ConfigFieldContext): string {
  if (ctx.endpointId) return ctx.endpointId
  const ids = planEndpointIds(ctx.platformId, ctx.planId)
  throw new Error(
    ids.length > 0
      ? `\`endpointId\` is required — this plan has several endpoints: ${ids.join(', ')}`
      : '`endpointId` is required to target an endpoint override',
  )
}

function coerceModels(raw: unknown): EndpointModel[] {
  return asArray(raw, 'models').map((entry, i) => {
    const m = asRecord(entry, `models[${i}]`)
    const id = m.id
    if (typeof id !== 'string' || !id) throw new Error(`\`models[${i}].id\` is required and must be a non-empty string`)
    const tasks = m.tasks === undefined ? undefined : asArray(m.tasks, `models[${i}].tasks`).map((t) => {
      if (typeof t !== 'string' || !CAPABILITY_ORDER.includes(t as CapabilityTask)) {
        throw new Error(`unknown capability "${String(t)}" — expected one of: ${CAPABILITY_ORDER.join(', ')}`)
      }
      return t as CapabilityTask
    })
    return { id, ...(typeof m.name === 'string' ? { name: m.name } : {}), ...(tasks ? { tasks } : {}) }
  })
}

function pruneOverride(o: EndpointOverride): EndpointOverride {
  const out: EndpointOverride = {}
  if (o.baseUrl?.trim()) out.baseUrl = o.baseUrl.trim()
  if (o.routes && Object.keys(o.routes).length > 0) out.routes = o.routes
  if (o.models && o.models.length > 0) out.models = o.models
  if (o.extraEnv && Object.keys(o.extraEnv).length > 0) out.extraEnv = o.extraEnv
  if (o.modelMapping && Object.keys(o.modelMapping).length > 0) out.modelMapping = o.modelMapping
  return out
}

/** Fold the override fields present in `values` into `overrides[endpointId]`, leaving every other entry alone. */
function mergeOverrides(
  current: Record<string, EndpointOverride> | undefined,
  values: Record<string, unknown>,
  endpointId: string,
): Record<string, EndpointOverride> {
  const overrides = { ...(current ?? {}) }
  const target: EndpointOverride = { ...(overrides[endpointId] ?? {}) }
  if ('endpointBaseUrl' in values) target.baseUrl = optionalString(values, 'endpointBaseUrl') ?? ''
  if ('routes' in values) {
    const merged = mergeMap<string>(target.routes as Record<string, string> | undefined, asRecord(values.routes, 'routes'))
    target.routes = Object.keys(merged).length > 0 ? (merged as EndpointOverride['routes']) : undefined
  }
  if ('models' in values) target.models = coerceModels(values.models)
  if ('modelMapping' in values) {
    target.modelMapping = mergeMap<ProviderModelEnv[keyof ProviderModelEnv]>(
      target.modelMapping,
      asRecord(values.modelMapping, 'modelMapping'),
    ) as ProviderModelEnv
  }
  if ('extraEnv' in values) target.extraEnv = mergeMap<string>(target.extraEnv, asRecord(values.extraEnv, 'extraEnv'))
  const pruned = pruneOverride(target)
  if (Object.keys(pruned).length === 0) delete overrides[endpointId]
  else overrides[endpointId] = pruned
  return overrides
}

export const credentialResourceDef: ResourceDef<Credential> = {
  resource: 'ai-provider',
  label: 'AI Provider Key',
  description:
    'API keys bound to a provider platform + plan, plus that key\'s per-endpoint overrides (Settings → AI Provider). The `secret` is masked on read as "***last6" — send a new value to replace it, or omit it to keep the stored one. `baseUrl` is the key\'s site root. Override fields (endpointBaseUrl / routes / models / modelMapping / extraEnv) target one endpoint via `endpointId` and are merged, so send only what changes.',
  projectScoped: false,
  fields: [
    { key: 'platformId', label: 'Platform', type: 'string', required: true, note: 'Platform id, e.g. "zhipu-cn" or "custom:<uuid>". Call config_read first to list them.' },
    { key: 'planId', label: 'Plan', type: 'string', required: true },
    { key: 'name', label: 'Name', type: 'string', required: true, note: 'Key label, unique within the platform.' },
    { key: 'secret', label: 'Secret / API Key', type: 'string', secret: true },
    { key: 'secretEnv', label: 'Secret Env Var', type: 'string', note: 'Read the key from this environment variable instead of the stored secret.' },
    { key: 'notes', label: 'Notes', type: 'string' },
    {
      key: 'endpointId',
      label: 'Endpoint',
      type: 'string',
      selector: true,
      note: 'Which endpoint the override fields below target. Optional when the plan has exactly one endpoint.',
    },
    { key: 'baseUrl', label: 'Base URL', type: 'string', note: 'The site root this key points at, replacing the plan\'s. Every endpoint below hangs off it by route. Empty string clears it.' },
    { key: 'endpointBaseUrl', label: 'Endpoint Host Override', type: 'string', note: 'Rare — only when one endpoint answers from a different origin than the rest. Normally leave empty and set `routes` instead.' },
    { key: 'routes', label: 'Route Overrides', type: 'env', note: 'Per-protocol request path, e.g. { "anthropic-messages": "/api/anthropic/v1/messages" }. Measured from the base URL origin. Merged key by key; pass null for a protocol to restore its default.' },
    { key: 'models', label: 'Enabled Models', type: 'models', note: '{ id, name?, tasks? }[] — the models enabled on this endpoint. Replaces the list.' },
    { key: 'modelMapping', label: 'Model Mapping', type: 'model-mapping', note: 'Claude-harness slots → { default|opus|sonnet|haiku|subagent: { id, name? } }. Merged slot by slot; pass null for a slot to clear it.' },
    { key: 'extraEnv', label: 'Environment Variables', type: 'env', note: 'Merged key by key; pass null for a key to remove it.' },
  ],
  identifyBy: (record) => ({ title: record.name, subtitle: `${record.platformId} / ${record.planId}` }),
  list: () => listCredentials(),
  toRecordSummary: (record) => ({ ...record }),
  contextOf: (record, values) => {
    const platformId = optionalString(values, 'platformId') ?? record?.platformId
    const planId = optionalString(values, 'planId') ?? record?.planId
    const ids = planEndpointIds(platformId, planId)
    const endpointId = optionalString(values, 'endpointId') ?? (ids.length === 1 ? ids[0] : undefined)
    return { platformId, planId, endpointId, credentialId: record?.id }
  },
  readField: (record, key, ctx) => {
    if (!(OVERRIDE_FIELDS as readonly string[]).includes(key)) return (record as unknown as Record<string, unknown>)[key]
    const override = ctx.endpointId ? record.overrides?.[ctx.endpointId] : undefined
    switch (key) {
      case 'endpointBaseUrl':
        return override?.baseUrl ?? ''
      case 'routes':
        return override?.routes ?? {}
      case 'models':
        return override?.models ?? []
      case 'modelMapping':
        return override?.modelMapping ?? {}
      default:
        return override?.extraEnv ?? {}
    }
  },
  create: (_projectPath, values, ctx) => {
    const hasOverrides = OVERRIDE_FIELDS.some((k) => k in values)
    return createCredential({
      platformId: requireString(values, 'platformId'),
      planId: requireString(values, 'planId'),
      name: requireString(values, 'name'),
      secret: optionalString(values, 'secret'),
      secretEnv: optionalString(values, 'secretEnv'),
      baseUrl: optionalString(values, 'baseUrl'),
      overrides: hasOverrides ? mergeOverrides(undefined, values, requireEndpointId(ctx)) : undefined,
      notes: optionalString(values, 'notes'),
    })
  },
  update: (id, values, ctx) => {
    const patch: UpdateCredentialInput = {}
    if ('name' in values) patch.name = requireString(values, 'name')
    if ('secret' in values) patch.secret = optionalString(values, 'secret')
    if ('secretEnv' in values) patch.secretEnv = optionalString(values, 'secretEnv')
    if ('baseUrl' in values) patch.baseUrl = optionalString(values, 'baseUrl') ?? ''
    if ('notes' in values) patch.notes = optionalString(values, 'notes')
    if (OVERRIDE_FIELDS.some((k) => k in values)) {
      const existing = listCredentials().find((c) => c.id === id)
      if (!existing) return undefined
      patch.overrides = mergeOverrides(existing.overrides, values, requireEndpointId(ctx))
    }
    return updateCredential(id, patch)
  },
  delete: (id) => deleteCredential(id),
}
