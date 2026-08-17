import type { CapabilityTask } from '../agent-types'
import type { CatalogModel, ModelCatalog } from '../model-catalog-types'
import { MODEL_TASK_ORDER, modelTasks } from '../model-tasks'
import type { ProtocolFamily } from './protocols'
import { FAMILY_TASKS } from './protocols'
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
  byFamily: Partial<Record<ProtocolFamily, CapabilityTask[]>>
}

export const MAX_DISCOVERED_MODELS = 500

/**
 * NewAPI/one-api `supported_endpoint_types` → the wire family that type speaks.
 * Tasks are NOT inferred here — they come from the official catalog / model id.
 * `jina-rerank` / `embeddings` have no SuperOne family and are ignored.
 */
export const ENDPOINT_TYPE_FAMILY: Record<string, ProtocolFamily> = {
  openai: 'openai',
  'openai-response': 'openai',
  'openai-response-compact': 'openai',
  anthropic: 'anthropic',
  gemini: 'google',
  'image-generation': 'openai',
  'openai-video': 'openai',
}

/** @deprecated Use ENDPOINT_TYPE_FAMILY + catalog tasks. Kept so older callers still typecheck. */
export const ENDPOINT_TYPE_MAP: Record<string, { family: ProtocolFamily; task: CapabilityTask }> = {
  openai: { family: 'openai', task: 'chat' },
  'openai-response': { family: 'openai', task: 'chat' },
  'openai-response-compact': { family: 'openai', task: 'chat' },
  anthropic: { family: 'anthropic', task: 'chat' },
  gemini: { family: 'google', task: 'chat' },
  'image-generation': { family: 'openai', task: 'image' },
  'openai-video': { family: 'openai', task: 'video' },
}

function addTask(byFamily: Partial<Record<ProtocolFamily, CapabilityTask[]>>, family: ProtocolFamily, task: CapabilityTask): void {
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

function declaredFamilies(types: string[]): Set<ProtocolFamily> {
  const out = new Set<ProtocolFamily>()
  for (const t of types) {
    const family = ENDPOINT_TYPE_FAMILY[t]
    if (family) out.add(family)
  }
  return out
}

/**
 * Which wires from `types` can carry `task`. Order is preference (first wins for
 * single-wire tasks). Chat may ride every listed chat wire.
 */
function familiesForTask(task: CapabilityTask, types: ReadonlySet<string>): ProtocolFamily[] {
  switch (task) {
    case 'chat': {
      const out: ProtocolFamily[] = []
      if (types.has('openai') || types.has('openai-response') || types.has('openai-response-compact')) out.push('openai')
      if (types.has('anthropic')) out.push('anthropic')
      if (types.has('gemini')) out.push('google')
      return out
    }
    case 'image':
      if (types.has('image-generation') || types.has('openai')) return ['openai']
      if (types.has('gemini')) return ['google']
      return []
    case 'video':
      if (types.has('openai-video')) return ['openai']
      return []
    case 'tts':
    case 'asr':
      if (types.has('openai')) return ['openai']
      return []
  }
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
 * Tasks come from the official catalog (then id / tags). `supported_endpoint_types`
 * only decide which family wire each task rides. When types cannot carry a video
 * task, fall back to newapi-video (Seedance/Kling on a chat-only type list).
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
): Partial<Record<ProtocolFamily, CapabilityTask[]>> | null {
  const types = endpointTypeList(hints.endpointTypes)
  const tasks = tasksForModel(id, hints)

  if (types.length === 0) {
    return fallbackByFamily(id, tasks, familyFromOwner(hints.ownedBy))
  }

  if (declaredFamilies(types).size === 0) return null

  const typeSet = new Set(types)
  const byFamily: Partial<Record<ProtocolFamily, CapabilityTask[]>> = {}
  for (const task of tasks) {
    const families = familiesForTask(task, typeSet)
    if (families.length === 0) {
      if (task === 'video') addTask(byFamily, 'newapi', 'video')
      continue
    }
    for (const family of families) addTask(byFamily, family, task)
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
    for (const [family, tasks] of Object.entries(m.byFamily) as [ProtocolFamily, CapabilityTask[]][]) {
      for (const task of tasks) addTask(existing.byFamily, family, task)
    }
  }
  return [...byId.values()]
}

/** Flatten + order tasks across families for UI display / tab filters. */
export function flattenDiscoveredTasks(byFamily: Partial<Record<ProtocolFamily, CapabilityTask[]>>): CapabilityTask[] {
  const set = new Set<CapabilityTask>()
  for (const tasks of Object.values(byFamily)) {
    for (const t of tasks ?? []) set.add(t)
  }
  return MODEL_TASK_ORDER.filter((t) => set.has(t))
}

/** Drop tasks a family cannot serve and empty families. */
export function sanitizeDiscoveredByFamily(
  byFamily: Partial<Record<ProtocolFamily, CapabilityTask[]>>,
): Partial<Record<ProtocolFamily, CapabilityTask[]>> {
  const next: Partial<Record<ProtocolFamily, CapabilityTask[]>> = {}
  for (const [family, tasks] of Object.entries(byFamily) as [ProtocolFamily, CapabilityTask[]][]) {
    const allowed = new Set(FAMILY_TASKS[family])
    const cleaned = tasks.filter((t) => allowed.has(t))
    if (cleaned.length > 0) next[family] = cleaned
  }
  return next
}

/**
 * Parse a NewAPI/one-api-lineage `GET {site root}/api/pricing` response into capability-tagged models.
 * Returns `null` when the shape doesn't match (not a NewAPI-style gateway) so the caller can fall back
 * to the generic OpenAI models list. Entries whose endpoint types map to nothing usable (rerank,
 * embeddings) are dropped; duplicate `model_name` rows (one per billing channel) are merged, unioning
 * their capabilities.
 */
export function parseNewApiPricing(json: unknown, catalogIndex?: Map<string, CapabilityTask[]>): DiscoveredModel[] | null {
  if (!json || typeof json !== 'object') return null
  const data = (json as Record<string, unknown>).data
  if (!Array.isArray(data)) return null

  const models: DiscoveredModel[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const id = row.model_name
    if (typeof id !== 'string' || !id) continue
    const byFamily = resolveByFamily(id, {
      endpointTypes: row.supported_endpoint_types,
      ownedBy: stringHint(row, 'owner_by', 'owned_by', 'vendor_name'),
      tags: stringHint(row, 'tags'),
      inputModalities: row.input_modalities,
      outputModalities: row.output_modalities,
      catalogTasks: catalogIndex?.get(normalizeModelId(id)),
    })
    if (!byFamily || Object.keys(byFamily).length === 0) continue
    const name = stringHint(row, 'description', 'name')
    models.push({ id, name, byFamily })
  }
  return mergeById(models)
}

/**
 * Original One API `GET {site}/api/pricing` object form (`data.model_ratio` is a name→multiplier
 * map, no `supported_endpoint_types`). Returns `null` when the shape is not that object.
 */
export function parseOneApiRatioPricing(json: unknown): DiscoveredModel[] | null {
  if (!json || typeof json !== 'object') return null
  const data = (json as Record<string, unknown>).data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const ratio = (data as Record<string, unknown>).model_ratio
  if (!ratio || typeof ratio !== 'object' || Array.isArray(ratio)) return null

  const models: DiscoveredModel[] = []
  for (const id of Object.keys(ratio as Record<string, unknown>)) {
    if (!id) continue
    const byFamily = fallbackByFamily(id)
    if (Object.keys(byFamily).length === 0) continue
    models.push({ id, byFamily })
  }
  return mergeById(models)
}

/** New API array first; One API `model_ratio` object as fallback. `null` when neither matches. */
export function parseRelayPricing(json: unknown, catalogIndex?: Map<string, CapabilityTask[]>): DiscoveredModel[] | null {
  return parseNewApiPricing(json, catalogIndex) ?? parseOneApiRatioPricing(json)
}

/**
 * Parse OpenAI-compatible `GET {base}/v1/models` (NewAPI Bearer form).
 * Tasks come from `catalogIndex` (models.dev) then id heuristics; `supported_endpoint_types`
 * only choose which family wire each task rides.
 */
export function parseOpenAiModelsList(json: unknown, catalogIndex?: Map<string, CapabilityTask[]>): DiscoveredModel[] | null {
  if (!json || typeof json !== 'object') return null
  const data = (json as Record<string, unknown>).data
  if (!Array.isArray(data)) return null

  const models: DiscoveredModel[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const id = row.id
    if (typeof id !== 'string' || !id) continue
    const byFamily = resolveByFamily(id, {
      endpointTypes: row.supported_endpoint_types,
      ownedBy: stringHint(row, 'owned_by', 'owner_by', 'ownedBy'),
      tags: stringHint(row, 'tags'),
      inputModalities: row.input_modalities,
      outputModalities: row.output_modalities,
      catalogTasks: catalogIndex?.get(normalizeModelId(id)),
    })
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
