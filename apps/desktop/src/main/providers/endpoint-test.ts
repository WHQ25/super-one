import type { EndpointTestResult } from '@superone/shared/agent-types'
import {
  endpointBaseUrl,
  familyBaseUrl,
  PROTOCOL_FAMILY,
  type ProtocolFamily,
  type ServiceEndpoint,
  type WireProtocol,
} from '@superone/shared/platform-registry'

const DEFAULT_BASE_URL: Record<ProtocolFamily, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
  newapi: '',
  google: 'https://generativelanguage.googleapis.com',
}

const TEST_TIMEOUT_MS = 10000

/**
 * Prefer chat-capable probes for key-auth validation. Connection Test only needs one
 * auth surface — OpenAI models list first when present, then Google, then Anthropic.
 */
const AUTH_PROTOCOL_PRIORITY: WireProtocol[] = [
  'openai-chat',
  'openai-responses',
  'google-generative',
  'anthropic-messages',
]

const AUTH_FAMILY_FALLBACK: ProtocolFamily[] = ['openai', 'google', 'anthropic']

/** Family of a single endpoint — never borrowed from siblings. */
export function endpointFamily(endpoint: ServiceEndpoint): ProtocolFamily {
  return PROTOCOL_FAMILY[endpoint.protocols[0]]
}

/**
 * Models-list URL for one endpoint. Uses only that endpoint's baseUrl + family
 * (via familyBaseUrl, matching resolveService) so dual anthropic+openai plans
 * never probe one wire with the other's path or auth.
 */
export function modelsUrl(family: ProtocolFamily, baseUrl: string): string {
  const root = (baseUrl || DEFAULT_BASE_URL[family]).replace(/\/+$/, '')
  if (family === 'google') return `${root.replace(/\/v1(beta)?$/, '')}/v1beta/models`
  // OpenAI-compatible bases already carry their version segment (/v1, /v3, /v4…).
  // List at {base}/models — do not force /v1/models onto non-v1 bases (Zhipu v4, Ark v3).
  if (/\/v\d+(?:alpha|beta)?$/.test(root)) return `${root}/models`
  return `${root}/v1/models`
}

/** Anthropic Messages API URL — used when GET /v1/models is missing (e.g. DeepSeek). */
export function messagesUrl(baseUrl: string): string {
  const root = (baseUrl || DEFAULT_BASE_URL.anthropic).replace(/\/+$/, '')
  return `${root.replace(/\/v1$/, '')}/v1/messages`
}

export function authHeaders(family: ProtocolFamily, apiKey: string): Record<string, string> {
  if (family === 'anthropic') return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  if (family === 'google') return { 'x-goog-api-key': apiKey }
  return { Authorization: `Bearer ${apiKey}` }
}

/** Probe the same base the driver would get, so a routed endpoint is not tested at the default path. */
export function testEndpointModelsUrl(siteRoot: string, endpoint: ServiceEndpoint): string {
  const family = endpointFamily(endpoint)
  const protocol = endpoint.protocols[0]
  return modelsUrl(family, protocol ? endpointBaseUrl(siteRoot, endpoint, protocol) : familyBaseUrl(family, siteRoot))
}

/**
 * Pick one endpoint that best represents "is this API key accepted?".
 * Prefer OpenAI chat/responses, then Google generative, then Anthropic.
 * Media-only siblings (ark-video, sora, veo) are deprioritized.
 */
export function selectKeyAuthEndpoint(endpoints: ServiceEndpoint[]): ServiceEndpoint | null {
  if (endpoints.length === 0) return null
  for (const protocol of AUTH_PROTOCOL_PRIORITY) {
    const match = endpoints.find((e) => e.protocols.includes(protocol))
    if (match) return match
  }
  for (const family of AUTH_FAMILY_FALLBACK) {
    const match = endpoints.find((e) => endpointFamily(e) === family)
    if (match) return match
  }
  return endpoints[0]
}

/** 2xx, or client/rate errors that still prove the key was accepted. */
function isAuthAcceptedStatus(status: number): boolean {
  if (status >= 200 && status < 300) return true
  // Validation / model errors and rate limits imply auth succeeded.
  if (status === 400 || status === 422 || status === 429 || status === 529) return true
  return false
}

function invalidKeyResult(endpointId: string, status: number): EndpointTestResult {
  return { endpointId, success: false, status, error: 'Invalid API key' }
}

function failureResult(endpointId: string, status: number | undefined, error: string): EndpointTestResult {
  return { endpointId, success: false, status, error: error.slice(0, 200) }
}

async function probeModelsList(
  siteRoot: string,
  endpoint: ServiceEndpoint,
  apiKey: string,
  signal: AbortSignal,
): Promise<EndpointTestResult & { notFound?: boolean }> {
  const family = endpointFamily(endpoint)
  const url = testEndpointModelsUrl(siteRoot, endpoint)
  const res = await fetch(url, { headers: authHeaders(family, apiKey), signal })
  if (res.ok) return { endpointId: endpoint.id, success: true, status: res.status }
  if (res.status === 401 || res.status === 403) return invalidKeyResult(endpoint.id, res.status)
  if (res.status === 404) {
    const body = await res.text().catch(() => '')
    return {
      endpointId: endpoint.id,
      success: false,
      status: 404,
      error: (body || res.statusText).slice(0, 200),
      notFound: true,
    }
  }
  const body = await res.text().catch(() => '')
  return failureResult(endpoint.id, res.status, body || res.statusText)
}

/**
 * Anthropic Messages probe. Used when GET /v1/models is 404 (common on third-party
 * Anthropic-compat bases that only implement /v1/messages).
 */
async function probeAnthropicMessages(
  siteRoot: string,
  endpoint: ServiceEndpoint,
  apiKey: string,
  signal: AbortSignal,
): Promise<EndpointTestResult> {
  const base = endpointBaseUrl(siteRoot, endpoint, 'anthropic-messages')
  const url = messagesUrl(base)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders('anthropic', apiKey),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    }),
    signal,
  })
  if (isAuthAcceptedStatus(res.status)) {
    return { endpointId: endpoint.id, success: true, status: res.status }
  }
  if (res.status === 401 || res.status === 403) return invalidKeyResult(endpoint.id, res.status)
  const body = await res.text().catch(() => '')
  return failureResult(endpoint.id, res.status, body || res.statusText)
}

/**
 * Tests one addressable service with a family-appropriate auth probe.
 * Anthropic: GET /v1/models, then POST /v1/messages on 404.
 * OpenAI / Google: GET models list (2xx = success).
 */
export async function testServiceEndpoint(
  siteRoot: string,
  endpoint: ServiceEndpoint,
  apiKey: string,
): Promise<EndpointTestResult> {
  const family = endpointFamily(endpoint)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
  try {
    const modelsResult = await probeModelsList(siteRoot, endpoint, apiKey, controller.signal)
    if (modelsResult.success || modelsResult.status === 401 || modelsResult.status === 403) {
      const { notFound: _n, ...result } = modelsResult
      return result
    }
    if (family === 'anthropic' && modelsResult.notFound) {
      return await probeAnthropicMessages(siteRoot, endpoint, apiKey, controller.signal)
    }
    const { notFound: _n, ...result } = modelsResult
    return result
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === 'AbortError'
          ? `Timed out after ${TEST_TIMEOUT_MS / 1000}s`
          : err.message
        : String(err)
    return { endpointId: endpoint.id, success: false, error: message }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Connection Test (multiple endpoints): probe **one** preferred auth surface so a key
 * is not rejected because a sibling protocol path lacks /v1/models (e.g. DeepSeek anthropic).
 * Endpoint Test (single endpoint): probe that exact config with family-appropriate fallbacks.
 */
export async function testServiceEndpoints(
  siteRoot: string,
  endpoints: ServiceEndpoint[],
  apiKey: string,
): Promise<EndpointTestResult[]> {
  if (endpoints.length === 0) return []
  if (endpoints.length === 1) {
    return [await testServiceEndpoint(siteRoot, endpoints[0], apiKey)]
  }
  const preferred = selectKeyAuthEndpoint(endpoints)
  if (!preferred) return []
  return [await testServiceEndpoint(siteRoot, preferred, apiKey)]
}
