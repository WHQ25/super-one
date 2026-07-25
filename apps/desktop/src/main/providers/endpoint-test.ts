import type { EndpointTestResult } from '@superone/shared/agent-types'
import {
  familyBaseUrl,
  PROTOCOL_FAMILY,
  type ProtocolFamily,
  type ServiceEndpoint,
} from '@superone/shared/platform-registry'

const DEFAULT_BASE_URL: Record<ProtocolFamily, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  newapi: '',
  google: 'https://generativelanguage.googleapis.com',
}

const TEST_TIMEOUT_MS = 10000

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
  return `${root.replace(/\/v1$/, '')}/v1/models`
}

export function authHeaders(family: ProtocolFamily, apiKey: string): Record<string, string> {
  if (family === 'anthropic') return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  if (family === 'google') return { 'x-goog-api-key': apiKey }
  return { Authorization: `Bearer ${apiKey}` }
}

export function testEndpointModelsUrl(endpoint: ServiceEndpoint): string {
  const family = endpointFamily(endpoint)
  return modelsUrl(family, familyBaseUrl(family, endpoint.baseUrl))
}

/** Tests one addressable service by GETing its models-list endpoint; 2xx = success. */
export async function testServiceEndpoint(endpoint: ServiceEndpoint, apiKey: string): Promise<EndpointTestResult> {
  const family = endpointFamily(endpoint)
  const url = testEndpointModelsUrl(endpoint)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
  try {
    const headers = authHeaders(family, apiKey)
    const res = await fetch(url, { headers, signal: controller.signal })
    if (res.ok) return { endpointId: endpoint.id, success: true, status: res.status }
    const body = await res.text().catch(() => '')
    return { endpointId: endpoint.id, success: false, status: res.status, error: (body || res.statusText).slice(0, 200) }
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
 * Test every endpoint independently (parallel). Each keeps its own baseUrl, family,
 * and auth headers — no first-endpoint-only shortcut that mixed dual-protocol plans.
 */
export async function testServiceEndpoints(endpoints: ServiceEndpoint[], apiKey: string): Promise<EndpointTestResult[]> {
  if (endpoints.length === 0) return []
  return Promise.all(endpoints.map((endpoint) => testServiceEndpoint(endpoint, apiKey)))
}
