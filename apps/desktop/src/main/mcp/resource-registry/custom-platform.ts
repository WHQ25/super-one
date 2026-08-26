import { randomUUID } from 'node:crypto'
import type { ProviderModelEnv } from '@superone/shared/agent-types'
import {
  applyCapabilitiesToPlan,
  capabilityEndpoints,
  planCapabilities,
  PROTOCOL_TASKS,
  WIRE_PROTOCOLS,
  type EndpointDefaults,
  type Plan,
  type PlanCapabilities,
  type Platform,
  type ServiceEndpoint,
  type WireProtocol,
} from '@superone/shared/platform-registry'
import { createCredential, deleteCustomPlatform, listCustomPlatforms, upsertCustomPlatform } from '../../providers/credential-store'
import { asArray, asRecord, mergeMap, optionalString, requireString, type ResourceDef } from './types'

const DEFAULT_KEY_NAME = 'API Key'

function mainPlan(platform: Platform): Plan {
  const plan = platform.plans[0]
  if (!plan) throw new Error(`Custom provider "${platform.id}" has no plan`)
  return plan
}

/**
 * The endpoint a claude-harness model mapping attaches to. Mapping is an Anthropic-wire concept, so it
 * rides the anthropic endpoint when there is one and otherwise the openai-chat endpoint being bridged —
 * the same rule EndpointOverrideFields uses to decide whether to show the mapping editor at all.
 */
function mappingEndpointId(endpoints: ServiceEndpoint[]): string | undefined {
  return (
    endpoints.find((e) => e.protocols.includes('anthropic-messages'))?.id ??
    endpoints.find((e) => e.protocols.includes('openai-chat'))?.id
  )
}

function withDefaults(endpoint: ServiceEndpoint, defaults: EndpointDefaults): ServiceEndpoint {
  const next: EndpointDefaults = {}
  if (defaults.modelMapping && Object.keys(defaults.modelMapping).length > 0) next.modelMapping = defaults.modelMapping
  if (defaults.extraEnv && Object.keys(defaults.extraEnv).length > 0) next.extraEnv = defaults.extraEnv
  if (Object.keys(next).length === 0) {
    const { defaults: _drop, ...rest } = endpoint
    return rest
  }
  return { ...endpoint, defaults: next }
}

function withModelMapping(endpoints: ServiceEndpoint[], patch: Record<string, unknown>): ServiceEndpoint[] {
  const targetId = mappingEndpointId(endpoints)
  if (!targetId) throw new Error('`modelMapping` needs a chat endpoint — enable the Anthropic or OpenAI chat format first')
  return endpoints.map((e) =>
    e.id === targetId
      ? withDefaults(e, { ...e.defaults, modelMapping: mergeMap<ProviderModelEnv[keyof ProviderModelEnv]>(e.defaults?.modelMapping, patch) as ProviderModelEnv })
      : e,
  )
}

function withExtraEnv(endpoints: ServiceEndpoint[], patch: Record<string, unknown>): ServiceEndpoint[] {
  return endpoints.map((e) => withDefaults(e, { ...e.defaults, extraEnv: mergeMap<string>(e.defaults?.extraEnv, patch) }))
}

/**
 * Parse the `capabilities` field into a protocol list.
 *
 * Accepts a bare array as well as `{ protocols: [...] }` — the field carries exactly one list now, so
 * the wrapper object is ceremony an agent should not have to guess at.
 */
function coerceCapabilities(raw: unknown): PlanCapabilities {
  const list = Array.isArray(raw) ? raw : asRecord(raw, 'capabilities').protocols
  const protocols = asArray(list ?? [], 'capabilities.protocols').map((p) => {
    if (typeof p !== 'string' || !WIRE_PROTOCOLS.includes(p as WireProtocol)) {
      throw new Error(`unknown wire protocol "${String(p)}" — expected one of: ${WIRE_PROTOCOLS.join(', ')}`)
    }
    return p as WireProtocol
  })
  if (protocols.length === 0) throw new Error('`capabilities.protocols` must list at least one wire protocol')
  return { protocols }
}

function applyEndpointDefaults(endpoints: ServiceEndpoint[], values: Record<string, unknown>): ServiceEndpoint[] {
  let out = endpoints
  if ('modelMapping' in values) out = withModelMapping(out, asRecord(values.modelMapping, 'modelMapping'))
  if ('extraEnv' in values) out = withExtraEnv(out, asRecord(values.extraEnv, 'extraEnv'))
  return out
}

export const customPlatformResourceDef: ResourceDef<Platform> = {
  resource: 'custom-platform',
  label: 'Custom Provider',
  description:
    'User-defined AI provider platforms (Settings → AI Provider → +). Described the same way the settings form does: one shared base URL plus the wire protocols the provider speaks — endpoints are derived, never written by hand. Every field is independent: send only the one you are changing.',
  projectScoped: false,
  fields: [
    { key: 'name', label: 'Name', type: 'string', required: true },
    { key: 'description', label: 'Description', type: 'string' },
    {
      key: 'baseUrl',
      label: 'Base URL',
      type: 'string',
      required: true,
      note: 'One shared root, e.g. "https://relay.example.com". Per-format sub-paths (/v1, …) are derived.',
    },
    {
      key: 'capabilities',
      label: 'Wire Protocols',
      type: 'capabilities',
      required: true,
      note: `{ protocols: WireProtocol[] } (a bare array is accepted too). Each protocol implies the capabilities it serves — ${WIRE_PROTOCOLS.map((p) => `${p} → ${PROTOCOL_TASKS[p].join('/')}`).join('; ')}. Endpoints are derived: one per vendor family for non-video wires, one per video wire.`,
    },
    {
      key: 'modelMapping',
      label: 'Model Mapping',
      type: 'model-mapping',
      note: 'Claude-harness slots → { default|opus|sonnet|haiku|subagent: { id, name? } }. Merged slot by slot; pass null for a slot to clear it.',
    },
    {
      key: 'extraEnv',
      label: 'Environment Variables',
      type: 'env',
      note: 'Extra env vars for every endpoint. Merged key by key; pass null for a key to remove it.',
    },
    { key: 'brand', label: 'Brand', type: 'string', note: 'Icon + display grouping. Defaults to "custom".' },
    { key: 'catalogProviderId', label: 'Catalog Provider Id', type: 'string', note: 'models.dev provider id, when the provider mirrors a known catalog.' },
    { key: 'apiKey', label: 'API Key', type: 'string', createOnly: true, secret: true, note: 'Creates the first key alongside the provider, like the settings form does.' },
    { key: 'keyName', label: 'Key Label', type: 'string', createOnly: true },
  ],
  identifyBy: (record) => ({ title: record.name, subtitle: record.brand }),
  list: () => listCustomPlatforms(),
  toRecordSummary: (record) => ({ ...record }),
  contextOf: (record) => ({ platformId: record?.id, planId: record ? mainPlan(record).id : undefined }),
  readField: (record, key) => {
    const plan = mainPlan(record)
    const caps = planCapabilities(plan)
    switch (key) {
      case 'baseUrl':
        return plan.baseUrl
      case 'capabilities':
        return { protocols: caps.protocols }
      case 'modelMapping': {
        const targetId = mappingEndpointId(plan.endpoints)
        return plan.endpoints.find((e) => e.id === targetId)?.defaults?.modelMapping ?? {}
      }
      case 'extraEnv': {
        let env: Record<string, string> = {}
        for (const endpoint of plan.endpoints) env = { ...env, ...endpoint.defaults?.extraEnv }
        return env
      }
      default:
        return (record as unknown as Record<string, unknown>)[key]
    }
  },
  create: (_projectPath, values) => {
    const baseUrl = requireString(values, 'baseUrl')
    const endpoints = applyEndpointDefaults(capabilityEndpoints(coerceCapabilities(values.capabilities)), values)
    if (endpoints.length === 0) throw new Error('`capabilities` must select at least one format with a capability')
    const id = `custom:${randomUUID()}`
    const plan: Plan = { id: 'api', name: 'API', auth: 'api-key', baseUrl, endpoints }
    const platform = upsertCustomPlatform({
      id,
      brand: optionalString(values, 'brand') ?? 'custom',
      name: requireString(values, 'name'),
      description: optionalString(values, 'description'),
      catalogProviderId: optionalString(values, 'catalogProviderId'),
      plans: [plan],
    })
    const apiKey = optionalString(values, 'apiKey')
    if (apiKey) {
      createCredential({
        platformId: id,
        planId: plan.id,
        name: optionalString(values, 'keyName') || DEFAULT_KEY_NAME,
        secret: apiKey,
        // Custom keys own their site root, same as one created from the settings form — otherwise
        // this key silently follows later edits to the plan while UI-created siblings do not.
        baseUrl,
      })
    }
    return platform
  },
  update: (id, values) => {
    const existing = listCustomPlatforms().find((p) => p.id === id)
    if (!existing) return undefined
    const plan = mainPlan(existing)
    let endpoints = plan.endpoints
    const baseUrl = 'baseUrl' in values ? requireString(values, 'baseUrl') : plan.baseUrl
    if ('capabilities' in values) {
      endpoints = applyCapabilitiesToPlan(plan, coerceCapabilities(values.capabilities))
      if (endpoints.length === 0) throw new Error('`capabilities` must select at least one format with a capability')
    }
    endpoints = applyEndpointDefaults(endpoints, values)
    return upsertCustomPlatform({
      ...existing,
      ...('brand' in values ? { brand: requireString(values, 'brand') } : {}),
      ...('name' in values ? { name: requireString(values, 'name') } : {}),
      ...('description' in values ? { description: optionalString(values, 'description') } : {}),
      ...('catalogProviderId' in values ? { catalogProviderId: optionalString(values, 'catalogProviderId') } : {}),
      plans: existing.plans.map((p) => (p.id === plan.id ? { ...p, baseUrl, endpoints } : p)),
    })
  },
  delete: (id) => deleteCustomPlatform(id),
}
