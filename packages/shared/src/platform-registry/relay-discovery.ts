import type { CapabilityTask } from '../agent-types'
import type { ModelCatalog } from '../model-catalog-types'
import { MODEL_TASK_ORDER, modelTasks } from '../model-tasks'
import type { ProtocolFamily } from './protocols'
import { FAMILY_TASKS } from './protocols'

export interface DiscoveredModel {
  id: string
  name?: string
  byFamily: Partial<Record<ProtocolFamily, CapabilityTask[]>>
}

export const MAX_DISCOVERED_MODELS = 500

/**
 * NewAPI/one-api `supported_endpoint_types` → the protocol family + capability task it proves.
 * `jina-rerank` / `embeddings` have no SuperOne CapabilityTask (chat/image/video/tts/asr) and are
 * omitted — a model reporting only those is dropped entirely by parseNewApiPricing.
 */
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
function normalizeModelId(id: string): string {
  const slash = id.lastIndexOf('/')
  return (slash >= 0 ? id.slice(slash + 1) : id).toLowerCase()
}

const CANONICAL_CATALOG_PROVIDERS = ['openai', 'anthropic', 'google']

/**
 * Index every models.dev catalog model by its bare id so a discovered model with no
 * `supported_endpoint_types` (a plain OpenAI-compatible `/v1/models` response) can borrow its
 * real capability tasks instead of defaulting to chat-only. Canonical vendors win id collisions
 * since relays overwhelmingly proxy those ids verbatim (e.g. `gpt-image-1`, `dall-e-3`).
 */
export function buildCatalogTaskIndex(catalog: ModelCatalog): Map<string, CapabilityTask[]> {
  const index = new Map<string, CapabilityTask[]>()
  const providers = [...catalog.providers].sort(
    (a, b) => Number(CANONICAL_CATALOG_PROVIDERS.includes(b.id)) - Number(CANONICAL_CATALOG_PROVIDERS.includes(a.id)),
  )
  for (const provider of providers) {
    for (const model of provider.models) {
      const key = normalizeModelId(model.id)
      if (index.has(key)) continue
      const tasks = modelTasks(model)
      if (tasks.length > 0) index.set(key, tasks)
    }
  }
  return index
}

function byFamilyFromEndpointTypes(endpointTypes: unknown): Partial<Record<ProtocolFamily, CapabilityTask[]>> {
  const byFamily: Partial<Record<ProtocolFamily, CapabilityTask[]>> = {}
  if (!Array.isArray(endpointTypes)) return byFamily
  for (const et of endpointTypes) {
    const mapped = typeof et === 'string' ? ENDPOINT_TYPE_MAP[et] : undefined
    if (mapped) addTask(byFamily, mapped.family, mapped.task)
  }
  return byFamily
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
export function parseNewApiPricing(json: unknown): DiscoveredModel[] | null {
  if (!json || typeof json !== 'object') return null
  const data = (json as Record<string, unknown>).data
  if (!Array.isArray(data)) return null

  const models: DiscoveredModel[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const id = row.model_name
    if (typeof id !== 'string' || !id) continue
    const byFamily = byFamilyFromEndpointTypes(row.supported_endpoint_types)
    if (Object.keys(byFamily).length === 0) continue
    const name = typeof row.description === 'string' && row.description ? row.description : undefined
    models.push({ id, name, byFamily })
  }
  return mergeById(models)
}

/**
 * Parse OpenAI-compatible `GET {base}/v1/models` (NewAPI Bearer form). When NewAPI attaches
 * `supported_endpoint_types`, those map to openai/anthropic/google families. Plain OpenAI-compatible
 * gateways without that field fall back to a `catalogIndex` lookup (see `buildCatalogTaskIndex`) —
 * matching the discovered id against models.dev's real capability data — and only default to
 * openai/chat when no catalog match exists either.
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
    let byFamily = byFamilyFromEndpointTypes(row.supported_endpoint_types)
    if (Object.keys(byFamily).length === 0) {
      const catalogTasks = catalogIndex?.get(normalizeModelId(id))
      byFamily = { openai: catalogTasks && catalogTasks.length > 0 ? catalogTasks : ['chat'] }
    }
    const name = typeof row.name === 'string' && row.name ? row.name : undefined
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
