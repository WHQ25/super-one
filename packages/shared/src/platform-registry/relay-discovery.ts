import type { CapabilityTask } from '../agent-types'
import type { CatalogModel, ModelCatalog } from '../model-catalog-types'
import { MODEL_TASK_ORDER, modelTasks } from '../model-tasks'
import type { EndpointSlot, ProtocolFamily, WireProtocol } from './protocols'
import { endpointIdFor, protocolForRoute, slotTasks } from './protocols'
import {
  classifyModelById,
  fallbackByFamily,
  familyFromOwner,
  tasksFromModalities,
  tasksFromTags,
} from './relay-identify'

export interface DiscoveredModel {
  id: string
  name?: string
  byFamily: Partial<Record<EndpointSlot, CapabilityTask[]>>
}

export const MAX_DISCOVERED_MODELS = 500

/**
 * Conventional reading of a New API `supported_endpoint_types` **name**.
 *
 * This field is New API's own extension — upstream One API has no notion of a model being reachable
 * on more than one endpoint, so it never emits one.
 *
 * Names are each relay's own vocabulary and are only a convention — when a site publishes the real
 * route paths, {@link parseRelayEndpointRoutes} overrides this per site. Tasks are NOT inferred
 * here; they come from the official catalog / model id. `jina-rerank` / `embeddings` have no
 * SuperOne protocol and are deliberately absent.
 *
 * `openai-video` reads as Sora's wire because that is what the name says. New API reuses the same
 * name for its own `/video/generations`, which is a different wire — only a published route tells
 * the two apart, which is exactly what {@link parseRelayEndpointRoutes} recovers.
 */
export const ENDPOINT_TYPE_PROTOCOL: Record<string, WireProtocol> = {
  openai: 'openai-chat',
  'openai-response': 'openai-responses',
  'openai-response-compact': 'openai-responses',
  anthropic: 'anthropic-messages',
  gemini: 'google-generative',
  'image-generation': 'openai-images',
  'openai-video': 'openai-video',
}

/** A relay's endpoint-type names resolved to protocols via the route paths it publishes. */
export type RelayEndpointRoutes = Record<string, WireProtocol>

/** What discovery learned about a relay as a whole, applied while classifying its models. */
export interface RelayContext {
  /** Endpoint-type name → protocol, read from the site's published route paths. */
  routes?: RelayEndpointRoutes
  /**
   * Family to assume for a model no other signal can place — see `keyBoundFamily`. Set only for
   * relays where one key speaks one wire (Sub2API); leaving it undefined keeps the openai default.
   */
  defaultFamily?: ProtocolFamily
}

/**
 * Read New API's site-level `supported_endpoint` map off an `/api/pricing` payload and resolve each
 * declared path to the protocol that actually speaks it.
 *
 * This is the strongest endpoint signal a relay emits. The `supported_endpoint_types` names on each
 * model say which of these entries apply; this map says what each entry *is*. Paths we don't
 * implement are dropped so the caller falls back to {@link ENDPOINT_TYPE_PROTOCOL}.
 *
 * Shape: `{ "openai": { "path": "/v1/chat/completions", "method": "POST" }, … }`. A bare string
 * value is accepted too — New API's per-model endpoint override allows that form.
 */
export function parseRelayEndpointRoutes(json: unknown): RelayEndpointRoutes {
  const root = json && typeof json === 'object' ? (json as Record<string, unknown>) : null
  const declared = root?.supported_endpoint
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return {}
  const routes: RelayEndpointRoutes = {}
  for (const [name, value] of Object.entries(declared as Record<string, unknown>)) {
    const path = typeof value === 'string' ? value : asRoutePath(value)
    if (!path) continue
    const protocol = protocolForRoute(path)
    if (protocol) routes[name] = protocol
  }
  return routes
}

function asRoutePath(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const path = (value as Record<string, unknown>).path
  return typeof path === 'string' && path.trim() ? path : undefined
}

function addTask(byFamily: Partial<Record<EndpointSlot, CapabilityTask[]>>, family: EndpointSlot, task: CapabilityTask): void {
  const tasks = byFamily[family] ?? []
  if (!tasks.includes(task)) tasks.push(task)
  byFamily[family] = tasks
}

/** Bare model id with any `vendor/` namespace prefix stripped, for cross-catalog id matching. */
export function normalizeModelId(id: string): string {
  const slash = id.lastIndexOf('/')
  return (slash >= 0 ? id.slice(slash + 1) : id).toLowerCase()
}

/** Highest-priority first-party vendors for bare-id collisions (chat + multimodal). */
const CANONICAL_CATALOG_PROVIDERS = ['openai', 'anthropic', 'google'] as const

/**
 * Model-manufacturer first parties whose models.dev rows carry official API list prices.
 * Hosting platforms / aggregators (openrouter, anyapi, fireworks, together, nano-gpt, …) are
 * excluded so bare-id collisions prefer the manufacturer row (and its cost) over a null-cost
 * or marked-up proxy entry.
 */
const FIRST_PARTY_CATALOG_PROVIDERS = new Set<string>([
  ...CANONICAL_CATALOG_PROVIDERS,
  'xai',
  'deepseek',
  'mistral',
  'cohere',
  'meta',
  'moonshotai',
  'moonshotai-cn',
  'zhipuai',
  'zhipuai-coding-plan',
  'alibaba',
  'alibaba-cn',
  'minimax',
  'minimax-cn',
  'bytedance',
  'perplexity',
])

/**
 * Higher is better for bare-id collision resolution.
 * Order: canonical (openai/anthropic/google) > other first-party vendors > everyone else;
 * within a tier, prefer rows that publish list-price `cost` (so anyapi null-cost never shadows
 * deepseek official pricing).
 */
export function catalogModelCollisionScore(model: CatalogModel): number {
  const providerId = model.providerId
  let score = 0
  if ((CANONICAL_CATALOG_PROVIDERS as readonly string[]).includes(providerId)) score += 300
  else if (FIRST_PARTY_CATALOG_PROVIDERS.has(providerId)) score += 200
  else score += 100
  if (model.cost) score += 1
  return score
}

/**
 * Index every models.dev catalog model by its bare id so a discovered model with no
 * `supported_endpoint_types` (a plain OpenAI-compatible `/v1/models` response) can borrow its
 * real capability tasks instead of defaulting to chat-only. First-party vendors win id collisions
 * over aggregators; among peers, rows with list prices win so cost-aware UI is not blanked by
 * null-cost proxy entries (e.g. anyapi's `deepseek/deepseek-chat`).
 */
export function buildCatalogTaskIndex(catalog: ModelCatalog): Map<string, CapabilityTask[]> {
  const index = new Map<string, CapabilityTask[]>()
  const scores = new Map<string, number>()
  for (const provider of catalog.providers) {
    for (const model of provider.models) {
      const tasks = modelTasks(model)
      if (tasks.length === 0) continue
      const key = normalizeModelId(model.id)
      const score = catalogModelCollisionScore(model)
      const prev = scores.get(key)
      if (prev != null && prev >= score) continue
      scores.set(key, score)
      index.set(key, tasks)
    }
  }
  return index
}

/**
 * Same bare-id index as {@link buildCatalogTaskIndex}, but keeping the full catalog model so the
 * renderer can show context window / pricing / modality / reasoning info for custom and
 * auto-discovered models, not just their capability tasks.
 */
export function buildCatalogModelIndex(catalog: ModelCatalog): Map<string, CatalogModel> {
  const index = new Map<string, CatalogModel>()
  const scores = new Map<string, number>()
  for (const provider of catalog.providers) {
    for (const model of provider.models) {
      const key = normalizeModelId(model.id)
      const score = catalogModelCollisionScore(model)
      const prev = scores.get(key)
      if (prev != null && prev >= score) continue
      scores.set(key, score)
      index.set(key, model)
    }
  }
  return index
}

function hasExplicitEndpointTypes(endpointTypes: unknown): boolean {
  return Array.isArray(endpointTypes) && endpointTypes.length > 0
}

function endpointTypeList(endpointTypes: unknown): string[] {
  if (!Array.isArray(endpointTypes)) return []
  return endpointTypes.filter((t): t is string => typeof t === 'string' && t.length > 0)
}

/** The endpoint a declared type name lands on: its published route first, its conventional name second. */
function slotForEndpointType(type: string, routes?: RelayEndpointRoutes): EndpointSlot | undefined {
  const protocol = routes?.[type] ?? ENDPOINT_TYPE_PROTOCOL[type]
  return protocol ? endpointIdFor(protocol) : undefined
}

/** Distinct endpoints the relay says this model is reachable on, in declaration order. */
function declaredSlots(types: string[], routes?: RelayEndpointRoutes): EndpointSlot[] {
  const out: EndpointSlot[] = []
  for (const type of types) {
    const slot = slotForEndpointType(type, routes)
    if (slot && !out.includes(slot)) out.push(slot)
  }
  return out
}

/**
 * Preference when several declared endpoints can carry the same task.
 *
 * OpenAI leads because an OpenAI-compatible relay's own wire is the one it implements end to end;
 * a native-format endpoint next to it is a translation layer. Declaration order is deliberately NOT
 * used — relays list types in their own order and a model reachable on both `openai` and `gemini`
 * should route the same way on every relay.
 */
const SLOT_PREFERENCE: EndpointSlot[] = [
  'openai',
  'anthropic',
  'google',
  'volcengine',
  'newapi',
  'openai-video',
  'ark-video',
  'google-video',
  // A relay's own video wire ranks last: it works, but it is the one shape a customer cannot also
  // send to the vendor directly, so it is the fallback rather than the default.
  'newapi-video',
]

/**
 * Which of `slots` can carry `task`, most preferred first.
 *
 * Every one of them: a model the relay publishes on several wires is genuinely reachable on each,
 * and which to use is the user's call — a relay can serve one Seedance model at both Ark's
 * `/contents/generations/tasks` and its own `/video/generations`, and the two accept different
 * parameters. Collapsing to the leader here hid the second endpoint entirely, so the model never
 * appeared under it even after the relay declared it.
 */
function slotsForTask(task: CapabilityTask, slots: EndpointSlot[]): EndpointSlot[] {
  return slots
    .filter((slot) => slotTasks(slot).includes(task))
    .sort((a, b) => SLOT_PREFERENCE.indexOf(a) - SLOT_PREFERENCE.indexOf(b))
}

function tasksForModel(
  id: string,
  hints: {
    tags?: string
    inputModalities?: unknown
    outputModalities?: unknown
    catalogTasks?: CapabilityTask[]
  },
): CapabilityTask[] {
  if (hints.catalogTasks && hints.catalogTasks.length > 0) {
    return MODEL_TASK_ORDER.filter((t) => hints.catalogTasks!.includes(t))
  }
  const fromId = flattenDiscoveredTasks(classifyModelById(id))
  if (fromId.length > 0) return fromId
  const fromHints = [...tasksFromTags(hints.tags), ...tasksFromModalities(hints.inputModalities, hints.outputModalities)]
  if (fromHints.length > 0) return MODEL_TASK_ORDER.filter((t) => fromHints.includes(t))
  return ['chat']
}

function stringHint(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = row[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

/**
 * Tasks come from the official catalog (then id / tags). `supported_endpoint_types` only decide
 * which endpoint each task rides — resolved through the relay's published routes when it has any,
 * else through the name convention. When no declared endpoint can carry a video task, fall back to
 * newapi-video (Seedance/Kling listed under a chat-only type list, which is the common case).
 */
function resolveByFamily(
  id: string,
  hints: {
    endpointTypes?: unknown
    ownedBy?: string
    tags?: string
    inputModalities?: unknown
    outputModalities?: unknown
    catalogTasks?: CapabilityTask[]
  },
  context?: RelayContext,
): Partial<Record<EndpointSlot, CapabilityTask[]>> | null {
  const types = endpointTypeList(hints.endpointTypes)
  const tasks = tasksForModel(id, hints)

  if (types.length === 0) {
    // `owned_by` names the upstream for this one model and wins; the relay-wide default only
    // catches what it leaves unplaced (renamed aliases on a key bound to a single vendor).
    return fallbackByFamily(id, tasks, familyFromOwner(hints.ownedBy) ?? context?.defaultFamily)
  }

  const slots = declaredSlots(types, context?.routes)
  if (slots.length === 0) return null

  const byFamily: Partial<Record<EndpointSlot, CapabilityTask[]>> = {}
  for (const task of tasks) {
    const picked = slotsForTask(task, slots)
    if (picked.length === 0) {
      if (task === 'video') addTask(byFamily, 'newapi-video', 'video')
      continue
    }
    for (const slot of picked) addTask(byFamily, slot, task)
  }
  return Object.keys(byFamily).length > 0 ? byFamily : null
}

function mergeById(models: DiscoveredModel[]): DiscoveredModel[] {
  const byId = new Map<string, DiscoveredModel>()
  for (const m of models) {
    const existing = byId.get(m.id)
    if (!existing) {
      byId.set(m.id, { id: m.id, name: m.name, byFamily: { ...m.byFamily } })
      continue
    }
    if (!existing.name && m.name) existing.name = m.name
    for (const [family, tasks] of Object.entries(m.byFamily) as [EndpointSlot, CapabilityTask[]][]) {
      for (const task of tasks) addTask(existing.byFamily, family, task)
    }
  }
  return [...byId.values()]
}

/** Flatten + order tasks across families for UI display / tab filters. */
export function flattenDiscoveredTasks(byFamily: Partial<Record<EndpointSlot, CapabilityTask[]>>): CapabilityTask[] {
  const set = new Set<CapabilityTask>()
  for (const tasks of Object.values(byFamily)) {
    for (const t of tasks ?? []) set.add(t)
  }
  return MODEL_TASK_ORDER.filter((t) => set.has(t))
}

/** Drop tasks a family cannot serve and empty families. */
export function sanitizeDiscoveredByFamily(
  byFamily: Partial<Record<EndpointSlot, CapabilityTask[]>>,
): Partial<Record<EndpointSlot, CapabilityTask[]>> {
  const next: Partial<Record<EndpointSlot, CapabilityTask[]>> = {}
  for (const [family, tasks] of Object.entries(byFamily) as [EndpointSlot, CapabilityTask[]][]) {
    const allowed = new Set(slotTasks(family))
    const cleaned = tasks.filter((t) => allowed.has(t))
    if (cleaned.length > 0) next[family] = cleaned
  }
  return next
}

/**
 * Parse a New API `GET {site root}/api/pricing` response into capability-tagged models.
 * Returns `null` when the shape doesn't match (not a NewAPI-style gateway) so the caller can fall back
 * to the generic OpenAI models list. Entries whose endpoint types map to nothing usable (rerank,
 * embeddings) are dropped; duplicate `model_name` rows (one per billing channel) are merged, unioning
 * their capabilities.
 */
export function parseNewApiPricing(
  json: unknown,
  catalogIndex?: Map<string, CapabilityTask[]>,
  relayContext?: RelayContext,
): DiscoveredModel[] | null {
  if (!json || typeof json !== 'object') return null
  const data = (json as Record<string, unknown>).data
  if (!Array.isArray(data)) return null

  const context = { ...relayContext, routes: relayContext?.routes ?? parseRelayEndpointRoutes(json) }
  const models: DiscoveredModel[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const id = row.model_name
    if (typeof id !== 'string' || !id) continue
    const byFamily = resolveByFamily(
      id,
      {
        endpointTypes: row.supported_endpoint_types,
        ownedBy: stringHint(row, 'owner_by', 'owned_by', 'vendor_name'),
        tags: stringHint(row, 'tags'),
        inputModalities: row.input_modalities,
        outputModalities: row.output_modalities,
        catalogTasks: catalogIndex?.get(normalizeModelId(id)),
      },
      context,
    )
    if (!byFamily || Object.keys(byFamily).length === 0) continue
    const name = stringHint(row, 'description', 'name')
    models.push({ id, name, byFamily })
  }
  return mergeById(models)
}

/**
 * The `{ data: { model_ratio: { "<model>": <multiplier> } } }` pricing shape, which gives model
 * names and nothing else — no endpoint types, no tasks, no owner.
 *
 * Despite the name this is NOT upstream One API: `songquanpeng/one-api` registers no `/api/pricing`
 * route at all (only `/api/status` and an authenticated `/api/models`) and never exposes
 * `model_ratio` to clients. The shape comes from the many One API forks that add a public pricing
 * page, and we keep parsing it because those forks are common and it costs one probe we already
 * make. Returns `null` when the shape is not that object.
 */
export function parseOneApiRatioPricing(json: unknown, relayContext?: RelayContext): DiscoveredModel[] | null {
  if (!json || typeof json !== 'object') return null
  const data = (json as Record<string, unknown>).data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const ratio = (data as Record<string, unknown>).model_ratio
  if (!ratio || typeof ratio !== 'object' || Array.isArray(ratio)) return null

  const models: DiscoveredModel[] = []
  for (const id of Object.keys(ratio as Record<string, unknown>)) {
    if (!id) continue
    const byFamily = fallbackByFamily(id, undefined, relayContext?.defaultFamily)
    if (Object.keys(byFamily).length === 0) continue
    models.push({ id, byFamily })
  }
  return mergeById(models)
}

/** New API array first; One API `model_ratio` object as fallback. `null` when neither matches. */
export function parseRelayPricing(
  json: unknown,
  catalogIndex?: Map<string, CapabilityTask[]>,
  relayContext?: RelayContext,
): DiscoveredModel[] | null {
  return parseNewApiPricing(json, catalogIndex, relayContext) ?? parseOneApiRatioPricing(json, relayContext)
}

/**
 * Parse OpenAI-compatible `GET {base}/v1/models` (NewAPI Bearer form).
 * Tasks come from `catalogIndex` (models.dev) then id heuristics; `supported_endpoint_types`
 * only choose which family wire each task rides.
 */
export function parseOpenAiModelsList(
  json: unknown,
  catalogIndex?: Map<string, CapabilityTask[]>,
  context?: RelayContext,
): DiscoveredModel[] | null {
  if (!json || typeof json !== 'object') return null
  const data = (json as Record<string, unknown>).data
  if (!Array.isArray(data)) return null

  const models: DiscoveredModel[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const id = row.id
    if (typeof id !== 'string' || !id) continue
    const byFamily = resolveByFamily(
      id,
      {
        endpointTypes: row.supported_endpoint_types,
        ownedBy: stringHint(row, 'owned_by', 'owner_by', 'ownedBy'),
        tags: stringHint(row, 'tags'),
        inputModalities: row.input_modalities,
        outputModalities: row.output_modalities,
        catalogTasks: catalogIndex?.get(normalizeModelId(id)),
      },
      context,
    )
    if (!byFamily || Object.keys(byFamily).length === 0) continue
    const name = stringHint(row, 'name', 'display_name', 'description')
    models.push({ id, name, byFamily })
  }
  return mergeById(models)
}

/**
 * Combine pricing + models-list parses, unioning capabilities per id. modelsList seeds the map;
 * pricing contributes names and additional endpoint-type tags. Truncates to MAX_DISCOVERED_MODELS.
 */
export function mergeDiscovered(pricing: DiscoveredModel[] | null, modelsList: DiscoveredModel[] | null): DiscoveredModel[] {
  return mergeById([...(modelsList ?? []), ...(pricing ?? [])]).slice(0, MAX_DISCOVERED_MODELS)
}
