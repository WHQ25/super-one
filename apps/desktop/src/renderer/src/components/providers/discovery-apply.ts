import type { CapabilityTask, DiscoveredOpenAiModel, DiscoveredProtocolFamily } from '@superone/shared/agent-types'
import {
  customEndpointsFor,
  endpointServes,
  familyBaseUrl,
  PROTOCOL_FAMILY,
  PROTOCOL_FAMILIES,
  PROTOCOL_ORDER,
  type EndpointOverride,
  type Plan,
  type ProtocolFamily,
  type ServiceEndpoint,
} from '@superone/shared/platform-registry'
import type { CustomModel } from './custom-models'

function siteRootFrom(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v\d+$/, '')
}

/** OpenAI-format `/v1/models` probe target — prefer the plan's openai endpoint, else synthesize from any endpoint root. */
export function discoveryEndpoint(plan: Plan): ServiceEndpoint | undefined {
  const openai = plan.endpoints.find((e) => PROTOCOL_FAMILY[e.protocols[0]] === 'openai')
  if (openai) return openai
  const first = plan.endpoints[0]
  if (!first) return undefined
  return { id: 'openai', baseUrl: familyBaseUrl('openai', first.baseUrl), protocols: ['openai-chat'] }
}

function familyOf(endpoint: ServiceEndpoint): ProtocolFamily {
  return PROTOCOL_FAMILY[endpoint.protocols[0]]
}

function findFamilyEndpoint(endpoints: ServiceEndpoint[], family: ProtocolFamily): ServiceEndpoint | undefined {
  return endpoints.find((e) => e.id === family || familyOf(e) === family)
}

function modelByFamily(model: DiscoveredOpenAiModel): Partial<Record<ProtocolFamily, CapabilityTask[]>> {
  if (model.byFamily && Object.keys(model.byFamily).length > 0) {
    return model.byFamily as Partial<Record<ProtocolFamily, CapabilityTask[]>>
  }
  // Legacy / create-flow entries without byFamily — treat tasks as openai-only.
  return model.tasks.length > 0 ? { openai: model.tasks } : {}
}

function collectNeededTasksByFamily(models: DiscoveredOpenAiModel[]): Partial<Record<ProtocolFamily, CapabilityTask[]>> {
  const needed: Partial<Record<ProtocolFamily, Set<CapabilityTask>>> = {}
  for (const m of models) {
    for (const [family, tasks] of Object.entries(modelByFamily(m)) as [ProtocolFamily, CapabilityTask[]][]) {
      if (!tasks?.length) continue
      const set = needed[family] ?? new Set<CapabilityTask>()
      for (const t of tasks) set.add(t)
      needed[family] = set
    }
  }
  const out: Partial<Record<ProtocolFamily, CapabilityTask[]>> = {}
  for (const family of PROTOCOL_FAMILIES) {
    const set = needed[family]
    if (set && set.size > 0) out[family] = [...set]
  }
  return out
}

/**
 * Widen / synthesize plan endpoints so every family+task required by the given models is served.
 * Additive only. Returns undefined when the plan already covers everything.
 */
export function widenedPlanEndpoints(plan: Plan, siteBaseUrl: string, models: DiscoveredOpenAiModel[]): ServiceEndpoint[] | undefined {
  const needed = collectNeededTasksByFamily(models)
  if (Object.keys(needed).length === 0) return undefined

  const root = siteRootFrom(siteBaseUrl)
  let endpoints = [...plan.endpoints]
  let changed = false

  for (const family of PROTOCOL_FAMILIES) {
    const tasks = needed[family]
    if (!tasks?.length) continue
    const built = customEndpointsFor(family, tasks, root)[0]
    if (!built) continue
    const existing = findFamilyEndpoint(endpoints, family)
    if (!existing) {
      endpoints = [...endpoints, built]
      changed = true
      continue
    }
    const protocols = [...new Set([...existing.protocols, ...built.protocols])].sort(
      (a, b) => PROTOCOL_ORDER.indexOf(a) - PROTOCOL_ORDER.indexOf(b),
    )
    if (protocols.length === existing.protocols.length && protocols.every((p, i) => p === existing.protocols[i])) continue
    endpoints = endpoints.map((e) => (e.id === existing.id ? { ...existing, protocols } : e))
    changed = true
  }

  return changed ? endpoints : undefined
}

/** @deprecated Prefer widenedPlanEndpoints — kept as a thin openai-only wrapper for older tests/call sites. */
export function widenedOpenAiEndpoint(
  endpoint: ServiceEndpoint | undefined,
  baseUrl: string,
  models: DiscoveredOpenAiModel[],
): ServiceEndpoint | undefined {
  const plan: Plan = {
    id: 'api',
    name: 'API',
    auth: 'api-key',
    endpoints: endpoint ? [endpoint] : [],
  }
  const next = widenedPlanEndpoints(plan, baseUrl, models)
  if (!next) return undefined
  return next.find((e) => e.id === 'openai' || familyOf(e) === 'openai')
}

function cleanOverride(ov: EndpointOverride): EndpointOverride | undefined {
  const next: EndpointOverride = { ...ov }
  if (!next.models || next.models.length === 0) delete next.models
  return Object.keys(next).length > 0 ? next : undefined
}

function dropModel(overrides: Record<string, EndpointOverride>, id: string): Record<string, EndpointOverride> {
  const next: Record<string, EndpointOverride> = { ...overrides }
  for (const [epId, ov] of Object.entries(next)) {
    if (!ov.models?.some((m) => m.id === id)) continue
    const cleaned = cleanOverride({ ...ov, models: ov.models.filter((m) => m.id !== id) })
    if (cleaned) next[epId] = cleaned
    else delete next[epId]
  }
  return next
}

/**
 * Batch-apply discovered models into credential overrides, routing each model to the endpoint of its
 * protocol family only (anthropic models never land on the openai endpoint and vice versa).
 */
export function applyDiscoveredModels(
  overrides: Record<string, EndpointOverride> | undefined,
  plan: Plan,
  models: DiscoveredOpenAiModel[],
): Record<string, EndpointOverride> {
  let next: Record<string, EndpointOverride> = { ...(overrides ?? {}) }
  for (const m of models) {
    const id = m.id.trim()
    if (!id) continue
    const byFamily = modelByFamily(m)
    next = dropModel(next, id)
    for (const [family, tasks] of Object.entries(byFamily) as [DiscoveredProtocolFamily, CapabilityTask[]][]) {
      if (!tasks?.length) continue
      const ep = findFamilyEndpoint(plan.endpoints, family)
      if (!ep) continue
      const served = tasks.filter((t) => endpointServes(ep, t))
      if (served.length === 0) continue
      const ov = next[ep.id] ?? {}
      next[ep.id] = {
        ...ov,
        models: [...(ov.models ?? []), { id, name: m.name?.trim() || undefined, tasks: served }],
      }
    }
  }
  return next
}

/**
 * Merge discovered models into a create-flow's local custom-models draft (used before a credential
 * exists to write into, e.g. CustomPlatformForm). A manually-entered model wins over a discovered
 * one sharing the same id — the user's explicit entry is never silently overwritten.
 */
export function mergeDiscoveredIntoCustomModels(existing: CustomModel[], discovered: DiscoveredOpenAiModel[]): CustomModel[] {
  const ids = new Set(existing.map((m) => m.id))
  const additions = discovered
    .filter((m) => !ids.has(m.id))
    .map((m) => ({ id: m.id, name: m.name, tasks: m.tasks, byFamily: m.byFamily }))
  return [...existing, ...additions]
}

/** Custom-models rows also present in the discovered pool are excluded so they render once (in the Discovered group), not twice. */
export function excludeDiscoveredIds(customModels: CustomModel[], discovered: DiscoveredOpenAiModel[]): CustomModel[] {
  const ids = new Set(discovered.map((m) => m.id))
  return customModels.filter((m) => !ids.has(m.id))
}
