import type { CapabilityTask, DiscoverModelsResult, DiscoveredOpenAiModel } from '@superone/shared/agent-types'
import {
  MAX_DISCOVERED_MODELS,
  flattenDiscoveredTasks,
  mergeDiscovered,
  parseNewApiPricing,
  parseOpenAiModelsList,
  sanitizeDiscoveredByFamily,
  type DiscoveredModel,
  type ServiceEndpoint,
} from '@superone/shared/platform-registry'
import log from '../logger'
import { authHeaders, modelsUrl } from './endpoint-test'

const FETCH_TIMEOUT_MS = 8000
const BODY_PREVIEW_CHARS = 800

/** Strip a trailing `/v{n}` version segment — the inverse of familyBaseUrl's openai suffixing. */
function siteRootFrom(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v\d+$/, '')
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
async function fetchPricing(siteRoot: string): Promise<DiscoveredModel[] | null> {
  const url = `${siteRoot}/api/pricing`
  const result = await fetchJson(url)
  if (!result.ok) {
    log.info('[discover-models] pricing unavailable url=%s reason=%s', url, result.error)
    return null
  }
  const parsed = parseNewApiPricing(result.json)
  if (!parsed) {
    log.warn(
      '[discover-models] pricing parse returned null (shape mismatch) url=%s keys=%s',
      url,
      result.json && typeof result.json === 'object' ? Object.keys(result.json as object).join(',') : typeof result.json,
    )
    return null
  }
  log.info('[discover-models] pricing ok count=%d sample=%j', parsed.length, parsed.slice(0, 3))
  return parsed
}

/** Single OpenAI-format list — NewAPI returns all families here with supported_endpoint_types. */
async function fetchOpenAiModelsList(
  baseUrl: string,
  apiKey: string,
  catalogIndex?: Map<string, CapabilityTask[]>,
): Promise<DiscoveredModel[] | null> {
  const url = modelsUrl('openai', baseUrl)
  const result = await fetchJson(url, { headers: authHeaders('openai', apiKey) })
  if (!result.ok) {
    log.info('[discover-models] modelsList unavailable url=%s reason=%s', url, result.error)
    return null
  }
  const parsed = parseOpenAiModelsList(result.json, catalogIndex)
  if (!parsed) {
    log.warn(
      '[discover-models] modelsList parse returned null (shape mismatch) url=%s keys=%s sample=%j',
      url,
      result.json && typeof result.json === 'object' ? Object.keys(result.json as object).join(',') : typeof result.json,
      result.json && typeof result.json === 'object'
        ? {
            ...(result.json as Record<string, unknown>),
            data: Array.isArray((result.json as Record<string, unknown>).data)
              ? ((result.json as Record<string, unknown>).data as unknown[]).slice(0, 2)
              : (result.json as Record<string, unknown>).data,
          }
        : result.json,
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
  endpoint: ServiceEndpoint,
  apiKey: string,
  catalogIndex?: Map<string, CapabilityTask[]>,
): Promise<DiscoverModelsResult> {
  const siteRoot = siteRootFrom(endpoint.baseUrl)
  const listUrl = modelsUrl('openai', endpoint.baseUrl)
  log.info(
    '[discover-models] start endpointId=%s baseUrl=%s siteRoot=%s listUrl=%s pricingUrl=%s keyLen=%d keyPrefix=%s',
    endpoint.id,
    endpoint.baseUrl,
    siteRoot,
    listUrl,
    `${siteRoot}/api/pricing`,
    apiKey.length,
    apiKey ? `${apiKey.slice(0, 4)}…` : '(empty)',
  )

  const [pricing, modelsList] = await Promise.all([
    fetchPricing(siteRoot),
    fetchOpenAiModelsList(endpoint.baseUrl, apiKey, catalogIndex),
  ])

  const merged = mergeDiscovered(pricing, modelsList)
  const models: DiscoveredOpenAiModel[] = []
  let dropped = 0
  for (const m of merged) {
    const next = toResultModel(m)
    if (next) models.push(next)
    else dropped++
  }

  const result: DiscoverModelsResult = {
    models,
    truncated: merged.length >= MAX_DISCOVERED_MODELS,
    sources: { pricing: pricing ? 'ok' : 'unavailable', modelsList: modelsList ? 'ok' : 'unavailable' },
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
