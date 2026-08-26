import type { CapabilityTask, DiscoverModelsResult, DiscoveredOpenAiModel } from '@superone/shared/agent-types'
import {
  MAX_DISCOVERED_MODELS,
  extrasForRelayKind,
  extrasFromRelayData,
  familyBaseUrl,
  isGeminiModelsList,
  keyBoundFamily,
  detectModelsListDialect,
  flattenDiscoveredTasks,
  inferRelayKind,
  mergeDiscovered,
  mergeDiscoveredExtras,
  parseNewApiStatus,
  parseOpenAiModelsList,
  parseRelayEndpointRoutes,
  parseRelayPricing,
  parseSub2ApiPublicSettings,
  pricingHasEndpointTypes,
  relaySiteRoot,
  sanitizeDiscoveredByFamily,
  type DiscoveredModel,
  type RelayContext,
  type ServiceEndpoint,
} from '@superone/shared/platform-registry'
import log from '../logger'
import { authHeaders, modelsUrl } from './endpoint-test'

const FETCH_TIMEOUT_MS = 8000
const BODY_PREVIEW_CHARS = 800

/** Strip version + pasted API suffixes — the inverse of familyBaseUrl's openai suffixing. */
function siteRootFrom(baseUrl: string): string {
  return relaySiteRoot(baseUrl)
}

function previewBody(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > BODY_PREVIEW_CHARS ? `${t.slice(0, BODY_PREVIEW_CHARS)}…` : t
}

type FetchJsonResult =
  | { ok: true; status: number; json: unknown }
  | { ok: false; status?: number; error: string; bodyPreview?: string }

async function fetchJson(url: string, init?: RequestInit): Promise<FetchJsonResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const text = await res.text().catch(() => '')
    if (!res.ok) {
      log.warn('[discover-models] HTTP %s %s body=%s', res.status, url, previewBody(text))
      return { ok: false, status: res.status, error: `HTTP ${res.status}`, bodyPreview: previewBody(text) }
    }
    try {
      const json = text ? JSON.parse(text) : null
      log.info(
        '[discover-models] HTTP %s %s contentType=%s bodyPreview=%s',
        res.status,
        url,
        res.headers.get('content-type') ?? '',
        previewBody(text),
      )
      return { ok: true, status: res.status, json }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('[discover-models] JSON parse failed %s err=%s body=%s', url, message, previewBody(text))
      return { ok: false, status: res.status, error: `json_parse: ${message}`, bodyPreview: previewBody(text) }
    }
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === 'AbortError'
          ? `timeout after ${FETCH_TIMEOUT_MS}ms`
          : err.message
        : String(err)
    log.warn('[discover-models] fetch failed %s err=%s', url, message)
    return { ok: false, error: message }
  } finally {
    clearTimeout(timer)
  }
}

/** NewAPI/one-api pricing is a public, unauthenticated endpoint — no key sent. */
async function fetchPricingJson(siteRoot: string): Promise<unknown | null> {
  const url = `${siteRoot}/api/pricing`
  const result = await fetchJson(url)
  if (!result.ok) {
    log.info('[discover-models] pricing unavailable url=%s reason=%s', url, result.error)
    return null
  }
  return result.json
}

function parsePricing(
  json: unknown | null,
  catalogIndex?: Map<string, CapabilityTask[]>,
  context?: RelayContext,
): DiscoveredModel[] | null {
  if (json == null) return null
  const parsed = parseRelayPricing(json, catalogIndex, context)
  if (!parsed) {
    log.warn(
      '[discover-models] pricing parse returned null (shape mismatch) keys=%s',
      typeof json === 'object' ? Object.keys(json as object).join(',') : typeof json,
    )
    return null
  }
  log.info('[discover-models] pricing ok count=%d sample=%j', parsed.length, parsed.slice(0, 3))
  return parsed
}

async function fetchStatusFingerprint(siteRoot: string) {
  const url = `${siteRoot}/api/status`
  const result = await fetchJson(url)
  if (!result.ok) {
    log.info('[discover-models] status unavailable url=%s reason=%s', url, result.error)
    return null
  }
  const parsed = parseNewApiStatus(result.json)
  if (!parsed) {
    log.info('[discover-models] status parse returned null url=%s', url)
    return null
  }
  log.info('[discover-models] status ok kind=%s name=%s', parsed.kind, parsed.name ?? '')
  return parsed
}

/**
 * Sub2API gates `GET /v1beta/models` on the key's group platform (400 "API key group platform is
 * not gemini" otherwise), so a Gemini-shaped body proves the key speaks the Google wire. On relays
 * where every key reaches every wire this answers 200 for everyone and is therefore ignored — see
 * `keyBoundFamily`. Never a model source: New API answers here with its whole catalog restated in
 * Gemini shape, which would drag every chat model onto the Google endpoint.
 */
async function probeGeminiModelsList(siteRoot: string, apiKey: string): Promise<boolean> {
  const url = modelsUrl('google', siteRoot)
  const result = await fetchJson(url, { headers: authHeaders('google', apiKey) })
  if (!result.ok) {
    log.info('[discover-models] gemini probe unavailable url=%s reason=%s', url, result.error)
    return false
  }
  const ok = isGeminiModelsList(result.json)
  log.info('[discover-models] gemini probe url=%s geminiShape=%s', url, ok)
  return ok
}

async function fetchSub2Fingerprint(siteRoot: string) {
  const url = `${siteRoot}/api/v1/settings/public`
  const result = await fetchJson(url)
  if (!result.ok) {
    log.info('[discover-models] sub2 settings unavailable url=%s reason=%s', url, result.error)
    return null
  }
  const parsed = parseSub2ApiPublicSettings(result.json)
  if (!parsed) {
    log.info('[discover-models] sub2 settings parse returned null url=%s', url)
    return null
  }
  log.info('[discover-models] sub2 settings ok name=%s', parsed.name ?? '')
  return parsed
}

/** Single OpenAI-format list — NewAPI returns all families here with supported_endpoint_types. */
async function fetchModelsListJson(baseUrl: string, apiKey: string): Promise<unknown | null> {
  const url = modelsUrl('openai', baseUrl)
  const result = await fetchJson(url, { headers: authHeaders('openai', apiKey) })
  if (!result.ok) {
    log.info('[discover-models] modelsList unavailable url=%s reason=%s', url, result.error)
    return null
  }
  return result.json
}

function parseModelsList(
  json: unknown | null,
  catalogIndex?: Map<string, CapabilityTask[]>,
  context?: RelayContext,
): DiscoveredModel[] | null {
  if (json == null) return null
  const parsed = parseOpenAiModelsList(json, catalogIndex, context)
  if (!parsed) {
    log.warn(
      '[discover-models] modelsList parse returned null (shape mismatch) keys=%s sample=%j',
      typeof json === 'object' ? Object.keys(json as object).join(',') : typeof json,
      typeof json === 'object' && json !== null
        ? {
            ...(json as Record<string, unknown>),
            data: Array.isArray((json as Record<string, unknown>).data)
              ? ((json as Record<string, unknown>).data as unknown[]).slice(0, 2)
              : (json as Record<string, unknown>).data,
          }
        : json,
    )
    return null
  }
  log.info(
    '[discover-models] modelsList ok count=%d sample=%j',
    parsed.length,
    parsed.slice(0, 3).map((m) => ({ id: m.id, byFamily: m.byFamily })),
  )
  return parsed
}

function toResultModel(m: DiscoveredModel): DiscoveredOpenAiModel | null {
  const byFamily = sanitizeDiscoveredByFamily(m.byFamily)
  const tasks = flattenDiscoveredTasks(byFamily)
  if (tasks.length === 0) return null
  return { id: m.id, name: m.name, tasks, byFamily }
}

/**
 * Discover models available on a NewAPI-style relay via one OpenAI-format `/v1/models` call
 * (plus optional public `/api/pricing` for richer tags). Models are tagged per protocol family
 * from `supported_endpoint_types` so anthropic/gemini/openai can all be enabled on the right wire.
 * Never throws: either source failing degrades to 'unavailable', never blocks the other.
 */
export async function discoverModels(
  baseUrl: string,
  apiKey: string,
  catalogIndex?: Map<string, CapabilityTask[]>,
): Promise<DiscoverModelsResult> {
  const siteRoot = siteRootFrom(baseUrl)
  const openaiBase = familyBaseUrl('openai', siteRoot)
  const listUrl = modelsUrl('openai', openaiBase)
  log.info(
    '[discover-models] start baseUrl=%s siteRoot=%s listUrl=%s pricingUrl=%s keyLen=%d keyPrefix=%s',
    baseUrl,
    siteRoot,
    listUrl,
    `${siteRoot}/api/pricing`,
    apiKey.length,
    apiKey ? `${apiKey.slice(0, 4)}…` : '(empty)',
  )

  const [pricingJson, modelsListJson, status, sub2, geminiListOk] = await Promise.all([
    fetchPricingJson(siteRoot),
    fetchModelsListJson(openaiBase, apiKey),
    fetchStatusFingerprint(siteRoot),
    fetchSub2Fingerprint(siteRoot),
    probeGeminiModelsList(siteRoot, apiKey),
  ])

  // The site's published route paths name each endpoint type outright, so they outrank the type
  // names on every model. They live in the pricing payload, which is why parsing waits for both.
  const routes = parseRelayEndpointRoutes(pricingJson)
  if (Object.keys(routes).length > 0) log.info('[discover-models] declared routes=%j', routes)

  // Only Sub2API binds a key to a single upstream, so only there does the list dialect / gemini
  // probe tell us where an otherwise unplaceable model id belongs. `sub2` is its own fingerprint
  // probe, so this does not wait on the relay-kind inference below.
  const defaultFamily = sub2
    ? keyBoundFamily({ dialect: detectModelsListDialect(modelsListJson), geminiListOk })
    : undefined
  if (defaultFamily) log.info('[discover-models] key-bound family=%s geminiListOk=%s', defaultFamily, geminiListOk)

  const context = { routes, defaultFamily }
  const pricing = { models: parsePricing(pricingJson, catalogIndex, context), json: pricingJson }
  const modelsList = { models: parseModelsList(modelsListJson, catalogIndex, context), json: modelsListJson }

  const merged = mergeDiscovered(pricing.models, modelsList.models)
  const models: DiscoveredOpenAiModel[] = []
  let dropped = 0
  for (const m of merged) {
    const next = toResultModel(m)
    if (next) models.push(next)
    else dropped++
  }

  const relay = inferRelayKind({
    status,
    sub2,
    pricingHasEndpointTypes: pricingHasEndpointTypes(pricing.json),
    pricingOk: pricing.models != null,
    modelsListOk: modelsList.models != null,
  })
  const extras = mergeDiscoveredExtras(
    extrasFromRelayData(pricing.json),
    extrasFromRelayData(modelsList.json),
    extrasForRelayKind(relay.kind),
  )

  const result: DiscoverModelsResult = {
    models,
    truncated: merged.length >= MAX_DISCOVERED_MODELS,
    sources: { pricing: pricing.models ? 'ok' : 'unavailable', modelsList: modelsList.models ? 'ok' : 'unavailable' },
    extras: extras.length > 0 ? extras : undefined,
    relay,
  }
  log.info(
    '[discover-models] done sources=%j merged=%d dropped=%d returned=%d truncated=%s sample=%j',
    result.sources,
    merged.length,
    dropped,
    models.length,
    result.truncated,
    models.slice(0, 5).map((m) => ({ id: m.id, tasks: m.tasks, byFamily: m.byFamily })),
  )
  return result
}
