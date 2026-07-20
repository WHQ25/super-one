import type { EndpointTestResult } from '@superone/shared/agent-types'
import { PROTOCOL_FAMILY, type ProtocolFamily, type ServiceEndpoint } from '@superone/shared/platform-registry'

const DEFAULT_BASE_URL: Record<ProtocolFamily, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  newapi: '',
  google: 'https://generativelanguage.googleapis.com',
}

const TEST_TIMEOUT_MS = 10000

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

/** Tests one addressable service by GETing its models-list endpoint; 2xx = success. */
export async function testServiceEndpoint(endpoint: ServiceEndpoint, apiKey: string): Promise<EndpointTestResult> {
  const family = PROTOCOL_FAMILY[endpoint.protocols[0]]
  const url = modelsUrl(family, endpoint.baseUrl)
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

export async function testServiceEndpoints(endpoints: ServiceEndpoint[], apiKey: string): Promise<EndpointTestResult[]> {
  const first = endpoints[0]
  if (!first) return []
  return [await testServiceEndpoint(first, apiKey)]
}
