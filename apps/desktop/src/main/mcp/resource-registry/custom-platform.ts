import { randomUUID } from 'node:crypto'
import type { ProviderModelEnv } from '@superone/shared/agent-types'
import {
  applyCapabilitiesToPlan,
  capabilityEndpoints,
  CAPABILITY_ORDER,
  FAMILY_EXTRA_PROTOCOLS,
  FAMILY_TASKS,
  planCapabilities,
  PROTOCOL_FAMILIES,
  type CapabilityTask,
  type EndpointDefaults,
  type Plan,
  type PlanCapabilities,
  type Platform,
  type ProtocolFamily,
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

function coerceCapabilities(raw: unknown): PlanCapabilities {
  const obj = asRecord(raw, 'capabilities')
  const families = asArray(obj.families ?? [], 'capabilities.families').map((f) => {
    if (typeof f !== 'string' || !PROTOCOL_FAMILIES.includes(f as ProtocolFamily)) {
      throw new Error(`unknown format "${String(f)}" — expected one of: ${PROTOCOL_FAMILIES.join(', ')}`)
    }
    return f as ProtocolFamily
  })
  if (families.length === 0) throw new Error('`capabilities.families` must list at least one format')

  const tasks: Partial<Record<ProtocolFamily, CapabilityTask[]>> = {}
  const rawTasks = obj.tasks === undefined ? {} : asRecord(obj.tasks, 'capabilities.tasks')
  for (const family of families) {
    const picked = asArray(rawTasks[family] ?? FAMILY_TASKS[family], `capabilities.tasks.${family}`).map((t) => {
      if (typeof t !== 'string' || !CAPABILITY_ORDER.includes(t as CapabilityTask)) {
        throw new Error(`unknown capability "${String(t)}" — expected one of: ${CAPABILITY_ORDER.join(', ')}`)
      }
      if (!FAMILY_TASKS[family].includes(t as CapabilityTask)) {
        throw new Error(`format "${family}" cannot serve "${t}" — it supports: ${FAMILY_TASKS[family].join(', ')}`)
      }
      return t as CapabilityTask
    })
    tasks[family] = picked
  }

  const extras: Partial<Record<ProtocolFamily, WireProtocol[]>> = {}
  const rawExtras = obj.extras === undefined ? {} : asRecord(obj.extras, 'capabilities.extras')
  for (const family of families) {
    if (rawExtras[family] === undefined) continue
    const picked = asArray(rawExtras[family], `capabilities.extras.${family}`).map((p) => {
      if (typeof p !== 'string' || !FAMILY_EXTRA_PROTOCOLS[family].includes(p as WireProtocol)) {
        throw new Error(
          `unknown extra wire "${String(p)}" for format "${family}" — expected one of: ${FAMILY_EXTRA_PROTOCOLS[family].join(', ') || '(none)'}`,
        )
      }
      return p as WireProtocol
    })
    if (picked.length > 0) extras[family] = picked
  }

  return { families, tasks, extras }
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
    'User-defined AI provider platforms (Settings → AI Provider → +). Described the same way the settings form does: one shared base URL plus the wire formats and capabilities the provider exposes — endpoints are derived, never written by hand. Every field is independent: send only the one you are changing.',
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
      label: 'Formats & Capabilities',
      type: 'capabilities',
      required: true,
      note: `{ families: ("${PROTOCOL_FAMILIES.join('" | "')}")[], tasks?: { <family>: ("chat"|"image"|"video"|"tts"|"asr")[] }, extras?: { openai?: ["openai-responses"] } }. Omitting tasks for a family selects everything it can serve.`,
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
        return caps.baseUrl
      case 'capabilities':
        return { families: caps.families, tasks: caps.tasks, extras: caps.extras }
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
    const endpoints = applyEndpointDefaults(capabilityEndpoints(coerceCapabilities(values.capabilities), baseUrl), values)
    if (endpoints.length === 0) throw new Error('`capabilities` must select at least one format with a capability')
    const id = `custom:${randomUUID()}`
    const plan: Plan = { id: 'api', name: 'API', auth: 'api-key', endpoints }
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
      })
    }
    return platform
  },
  update: (id, values) => {
    const existing = listCustomPlatforms().find((p) => p.id === id)
    if (!existing) return undefined
    const plan = mainPlan(existing)
    let endpoints = plan.endpoints
    if ('capabilities' in values || 'baseUrl' in values) {
      const current = planCapabilities(plan)
      const caps = 'capabilities' in values ? coerceCapabilities(values.capabilities) : current
      const baseUrl = 'baseUrl' in values ? requireString(values, 'baseUrl') : current.baseUrl
      endpoints = applyCapabilitiesToPlan(plan, caps, baseUrl)
      if (endpoints.length === 0) throw new Error('`capabilities` must select at least one format with a capability')
    }
    endpoints = applyEndpointDefaults(endpoints, values)
    return upsertCustomPlatform({
      ...existing,
      ...('brand' in values ? { brand: requireString(values, 'brand') } : {}),
      ...('name' in values ? { name: requireString(values, 'name') } : {}),
      ...('description' in values ? { description: optionalString(values, 'description') } : {}),
      ...('catalogProviderId' in values ? { catalogProviderId: optionalString(values, 'catalogProviderId') } : {}),
      plans: existing.plans.map((p) => (p.id === plan.id ? { ...p, endpoints } : p)),
    })
  },
  delete: (id) => deleteCustomPlatform(id),
}
