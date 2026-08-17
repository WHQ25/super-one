import type { CapabilityTask, DiscoveredExtraProtocol, DiscoveredOpenAiModel, DiscoveredProtocolFamily } from '@superone/shared/agent-types'
import {
  customEndpointsFor,
  endpointServes,
  FAMILY_TASKS,
  familyBaseUrl,
  flattenDiscoveredTasks,
  normalizeModelId,
  PROTOCOL_FAMILY,
  PROTOCOL_FAMILIES,
  PROTOCOL_ORDER,
  relaySiteRoot,
  type EndpointOverride,
  type Plan,
  type ProtocolFamily,
  type ServiceEndpoint,
  type WireProtocol,
} from '@superone/shared/platform-registry'
import { MODEL_TASK_ORDER } from '@superone/shared/model-tasks'
import type { CustomModel } from './custom-models'

function siteRootFrom(baseUrl: string): string {
  return relaySiteRoot(baseUrl)
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

function extrasByFamily(extras?: readonly DiscoveredExtraProtocol[]): Partial<Record<ProtocolFamily, WireProtocol[]>> {
  const out: Partial<Record<ProtocolFamily, WireProtocol[]>> = {}
  if (extras?.includes('openai-responses')) out.openai = ['openai-responses']
  return out
}

/**
 * Widen / synthesize plan endpoints so every family+task required by the given models is served.
 * Additive only. Returns undefined when the plan already covers everything.
 */
export function widenedPlanEndpoints(
  plan: Plan,
  siteBaseUrl: string,
  models: DiscoveredOpenAiModel[],
  extras?: readonly DiscoveredExtraProtocol[],
): ServiceEndpoint[] | undefined {
  const needed = collectNeededTasksByFamily(models)
  const extra = extrasByFamily(extras)
  if (Object.keys(needed).length === 0 && Object.keys(extra).length === 0) return undefined

  const root = siteRootFrom(siteBaseUrl)
  let endpoints = [...plan.endpoints]
  let changed = false

  for (const family of PROTOCOL_FAMILIES) {
    const tasks = needed[family] ?? []
    const extraProtocols = extra[family] ?? []
    if (tasks.length === 0 && extraProtocols.length === 0) continue
    const built = customEndpointsFor(family, tasks, root, extraProtocols)[0]
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

/**
 * Rebuild a discovered-model list from enabled endpoint models. Used when a custom platform
 * was saved before the probe cache existed, so the detail page still has something to show.
 */
export function discoveredFromEndpoints(endpoints: ServiceEndpoint[]): DiscoveredOpenAiModel[] {
  const byId = new Map<string, DiscoveredOpenAiModel>()
  for (const e of endpoints) {
    const family = PROTOCOL_FAMILY[e.protocols[0]]
    if (!family) continue
    for (const m of e.models ?? []) {
      const id = m.id.trim()
      if (!id) continue
      const cur = byId.get(id) ?? { id, name: m.name, tasks: [], byFamily: {} }
      if (!cur.name && m.name) cur.name = m.name
      const tasks = m.tasks ?? []
      if (tasks.length > 0) {
        cur.byFamily = { ...cur.byFamily, [family]: tasks }
        cur.tasks = flattenDiscoveredTasks(cur.byFamily)
      }
      byId.set(id, cur)
    }
  }
  return [...byId.values()]
}

/** Prefer the persisted probe cache; otherwise infer from enabled endpoint models. */
export function cachedDiscoveredModels(
  cached: DiscoveredOpenAiModel[] | undefined,
  endpoints: ServiceEndpoint[],
): DiscoveredOpenAiModel[] {
  return cached && cached.length > 0 ? cached : discoveredFromEndpoints(endpoints)
}

function isPlaceholderName(id: string, name: string | undefined): boolean {
  const current = name?.trim()
  if (!current) return true
  return current === id || current.toLowerCase() === normalizeModelId(id)
}

/** Fill official models.dev display names onto discovered rows that still show a raw id. */
export function applyCatalogDisplayNames(
  models: DiscoveredOpenAiModel[],
  index: Map<string, { name: string }> | null | undefined,
): DiscoveredOpenAiModel[] {
  if (!index || models.length === 0) return models
  let changed = false
  const next = models.map((m) => {
    const official = index.get(normalizeModelId(m.id))?.name.trim()
    if (!official || !isPlaceholderName(m.id, m.name) || m.name === official) return m
    changed = true
    return { ...m, name: official }
  })
  return changed ? next : models
}

function redistributeByFamily(
  existing: Partial<Record<DiscoveredProtocolFamily, CapabilityTask[]>>,
  tasks: CapabilityTask[],
): Partial<Record<DiscoveredProtocolFamily, CapabilityTask[]>> {
  const byFamily: Partial<Record<DiscoveredProtocolFamily, CapabilityTask[]>> = {}
  const homes = PROTOCOL_FAMILIES.filter((f) => (existing[f]?.length ?? 0) > 0)
  const preferred = homes.length > 0 ? homes : (['openai'] as ProtocolFamily[])
  for (const task of tasks) {
    const home =
      preferred.find((f) => FAMILY_TASKS[f]?.includes(task)) ??
      PROTOCOL_FAMILIES.find((f) => FAMILY_TASKS[f].includes(task)) ??
      'openai'
    byFamily[home] = [...(byFamily[home] ?? []), task]
  }
  return byFamily
}

/** Apply a user edit to display name + supported tasks, keeping protocol-family routing. */
export function patchDiscoveredModel(
  model: DiscoveredOpenAiModel,
  patch: { name?: string; tasks: CapabilityTask[] },
): DiscoveredOpenAiModel {
  const tasks = MODEL_TASK_ORDER.filter((t) => patch.tasks.includes(t))
  const byFamily = redistributeByFamily(model.byFamily, tasks)
  return {
    ...model,
    name: patch.name?.trim() || undefined,
    tasks: flattenDiscoveredTasks(byFamily),
    byFamily,
  }
}
