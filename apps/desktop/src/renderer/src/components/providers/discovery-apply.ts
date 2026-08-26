import type { CapabilityTask, DiscoveredExtraProtocol, DiscoveredOpenAiModel } from '@superone/shared/agent-types'
import {
  applyCapabilitiesToPlan,
  endpointServes,
  familyBaseUrl,
  flattenDiscoveredTasks,
  isVideoWire,
  normalizeModelId,
  PROTOCOL_FAMILY,
  PROTOCOL_FAMILIES,
  protocolsForSlot,
  relaySiteRoot,
  slotForTask,
  slotTasks,
  VIDEO_WIRES,
  WIRE_PROTOCOLS,
  type EndpointOverride,
  type EndpointSlot,
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
  return plan.endpoints[0] ? { id: 'openai', protocols: ['openai-chat'] } : undefined
}

function familyOf(endpoint: ServiceEndpoint): ProtocolFamily {
  return PROTOCOL_FAMILY[endpoint.protocols[0]]
}

/**
 * The endpoint a slot names. Video wires own an endpoint each (id = the wire), so an exact id match
 * comes first; a family slot falls back to whichever endpoint speaks that family's non-video wires.
 */
function findSlotEndpoint(endpoints: ServiceEndpoint[], slot: EndpointSlot): ServiceEndpoint | undefined {
  const exact = endpoints.find((e) => e.id === slot)
  if (exact) return exact
  if (isVideoWire(slot)) return endpoints.find((e) => e.protocols.includes(slot))
  return endpoints.find((e) => familyOf(e) === slot && !e.protocols.every((p) => isVideoWire(p)))
}

/**
 * A model's slot→tasks map. A hand-entered model arrives with no `byFamily` at all and a bare family
 * can never carry video, so both cases are normalized onto a wire slot here rather than at each use.
 */
function modelByFamily(model: DiscoveredOpenAiModel): Partial<Record<EndpointSlot, CapabilityTask[]>> {
  const raw = (model.byFamily ?? {}) as Partial<Record<EndpointSlot, CapabilityTask[]>>
  if (Object.keys(raw).length === 0) {
    // Legacy / create-flow entries without byFamily — treat tasks as openai-only.
    return model.tasks.length > 0 ? { openai: model.tasks } : {}
  }
  const out: Partial<Record<EndpointSlot, CapabilityTask[]>> = {}
  const add = (slot: EndpointSlot, tasks: CapabilityTask[]): void => {
    if (tasks.length > 0) out[slot] = [...new Set([...(out[slot] ?? []), ...tasks])]
  }
  for (const [slot, tasks] of Object.entries(raw) as [EndpointSlot, CapabilityTask[]][]) {
    if (!tasks?.length) continue
    if (isVideoWire(slot)) {
      add(slot, tasks.filter((t) => t === 'video'))
      continue
    }
    add(slot, tasks.filter((t) => t !== 'video'))
    if (tasks.includes('video')) add(slotForTask(slot, 'video'), ['video'])
  }
  return out
}

/** Slots the given models need, in canonical order (families first, then video wires). */
function collectNeededTasksBySlot(models: DiscoveredOpenAiModel[]): Partial<Record<EndpointSlot, CapabilityTask[]>> {
  const needed: Partial<Record<EndpointSlot, Set<CapabilityTask>>> = {}
  for (const m of models) {
    for (const [slot, tasks] of Object.entries(modelByFamily(m)) as [EndpointSlot, CapabilityTask[]][]) {
      if (!tasks?.length) continue
      const set = needed[slot] ?? new Set<CapabilityTask>()
      for (const t of tasks) set.add(t)
      needed[slot] = set
    }
  }
  const out: Partial<Record<EndpointSlot, CapabilityTask[]>> = {}
  for (const slot of [...PROTOCOL_FAMILIES, ...VIDEO_WIRES] as EndpointSlot[]) {
    const set = needed[slot]
    if (set && set.size > 0) out[slot] = slotTasks(slot).filter((t) => set.has(t))
  }
  return out
}

/** Every wire protocol the discovered models (plus any explicitly reported opt-in wires) require. */
export function protocolsForDiscoveredSlots(
  models: DiscoveredOpenAiModel[],
  extras?: readonly DiscoveredExtraProtocol[],
): WireProtocol[] {
  const needed = collectNeededTasksBySlot(models)
  const out = new Set<WireProtocol>()
  for (const [slot, tasks] of Object.entries(needed) as [EndpointSlot, CapabilityTask[]][]) {
    for (const protocol of protocolsForSlot(slot, tasks)) out.add(protocol)
  }
  if (extras?.includes('openai-responses')) out.add('openai-responses')
  return WIRE_PROTOCOLS.filter((p) => out.has(p))
}

/**
 * Widen plan endpoints so every protocol the discovered models need is spoken. Additive only —
 * returns undefined when the plan already covers everything.
 *
 * Widening is just "the union of current and needed protocols, re-derived", so it delegates to
 * `applyCapabilitiesToPlan` and inherits its preservation of models, defaults, and any base URL the
 * user moved off the derived one.
 */
export function widenedPlanEndpoints(
  plan: Plan,
  models: DiscoveredOpenAiModel[],
  extras?: readonly DiscoveredExtraProtocol[],
): ServiceEndpoint[] | undefined {
  const current = new Set(plan.endpoints.flatMap((e) => e.protocols))
  const wanted = protocolsForDiscoveredSlots(models, extras)
  if (wanted.every((p) => current.has(p))) return undefined
  const union = WIRE_PROTOCOLS.filter((p) => current.has(p) || wanted.includes(p))
  return applyCapabilitiesToPlan(plan, { protocols: union })
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
    baseUrl,
    endpoints: endpoint ? [endpoint] : [],
  }
  const next = widenedPlanEndpoints(plan, models)
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
    for (const [family, tasks] of Object.entries(byFamily) as [EndpointSlot, CapabilityTask[]][]) {
      if (!tasks?.length) continue
      const ep = findSlotEndpoint(plan.endpoints, family)
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
    const wire = e.protocols[0]
    const family = PROTOCOL_FAMILY[wire]
    if (!family) continue
    // A video endpoint's slot is its wire, so a rebuilt list routes back to the same endpoint.
    const slot: EndpointSlot = isVideoWire(wire) ? wire : family
    for (const m of e.models ?? []) {
      const id = m.id.trim()
      if (!id) continue
      const cur = byId.get(id) ?? { id, name: m.name, tasks: [], byFamily: {} }
      if (!cur.name && m.name) cur.name = m.name
      const tasks = m.tasks ?? []
      if (tasks.length > 0) {
        cur.byFamily = { ...cur.byFamily, [slot]: tasks }
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

/**
 * Re-home a model's tasks onto slots after the user edits its task tags, keeping the routing it
 * already had wherever possible.
 *
 * A video task stays on the wire it was already classified onto: re-tagging a Seedance model must not
 * silently move it from the New API relay wire to Sora's, which would change which endpoint submits
 * it. Only a model with no prior video wire falls back to its family's default.
 */
function redistributeByFamily(
  existing: Partial<Record<EndpointSlot, CapabilityTask[]>>,
  tasks: CapabilityTask[],
  pinned?: Partial<Record<CapabilityTask, EndpointSlot>>,
): Partial<Record<EndpointSlot, CapabilityTask[]>> {
  const bySlot: Partial<Record<EndpointSlot, CapabilityTask[]>> = {}
  const occupied = ([...PROTOCOL_FAMILIES, ...VIDEO_WIRES] as EndpointSlot[]).filter(
    (slot) => (existing[slot]?.length ?? 0) > 0,
  )
  const occupiedFamilies = occupied.filter((slot) => !isVideoWire(slot)) as ProtocolFamily[]
  const preferred = occupiedFamilies.length > 0 ? occupiedFamilies : (['openai'] as ProtocolFamily[])
  const priorWire = occupied.find(isVideoWire)
  for (const task of tasks) {
    // An explicit pick wins over every inference — this is the user stating which wire a model speaks,
    // which for a relay exposing two video wires is something no heuristic can know.
    const pin = pinned?.[task]
    if (pin) {
      bySlot[pin] = [...(bySlot[pin] ?? []), task]
      continue
    }
    if (task === 'video') {
      const slot = priorWire ?? slotForTask(preferred.find((f) => slotTasks(f).includes('video')) ?? 'openai', 'video')
      bySlot[slot] = [...(bySlot[slot] ?? []), task]
      continue
    }
    const home =
      preferred.find((f) => slotTasks(f).includes(task)) ??
      PROTOCOL_FAMILIES.find((f) => slotTasks(f).includes(task)) ??
      'openai'
    bySlot[home] = [...(bySlot[home] ?? []), task]
  }
  return bySlot
}

/** Apply a user edit to display name + supported tasks, keeping protocol-family routing. */
export function patchDiscoveredModel(
  model: DiscoveredOpenAiModel,
  patch: { name?: string; tasks: CapabilityTask[]; slots?: Partial<Record<CapabilityTask, EndpointSlot>> },
): DiscoveredOpenAiModel {
  const tasks = MODEL_TASK_ORDER.filter((t) => patch.tasks.includes(t))
  const byFamily = redistributeByFamily(modelByFamily(model), tasks, patch.slots)
  return {
    ...model,
    name: patch.name?.trim() || undefined,
    tasks: flattenDiscoveredTasks(byFamily),
    byFamily,
  }
}

/** The endpoint slot currently serving each of a model's tasks — what the model editor preselects. */
export function modelSlotsByTask(model: DiscoveredOpenAiModel): Partial<Record<CapabilityTask, EndpointSlot>> {
  const out: Partial<Record<CapabilityTask, EndpointSlot>> = {}
  for (const [slot, tasks] of Object.entries(modelByFamily(model)) as [EndpointSlot, CapabilityTask[]][]) {
    for (const task of tasks) out[task] ??= slot
  }
  return out
}

/**
 * Endpoints that could serve a task, offered as slot choices in the model editor.
 *
 * Reads the plan's real endpoints rather than the protocol table, so the list reflects what this key
 * is actually configured for — offering Sora on a key that only speaks the New API relay wire would
 * just produce a model that never resolves.
 */
export function slotOptionsForTask(endpoints: ServiceEndpoint[], task: CapabilityTask): EndpointSlot[] {
  return endpoints
    .filter((e) => !e.disabled && endpointServes(e, task))
    .map((e) => e.id as EndpointSlot)
}
