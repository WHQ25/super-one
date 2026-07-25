import { useCallback, useState } from 'react'
import type { EndpointTestResult } from '@superone/shared/agent-types'
import {
  effectiveEndpoints,
  mergeEndpoint,
  type Credential,
  type EndpointOverride,
  type Plan,
  type Platform,
  type ServiceEndpoint,
} from '@superone/shared/platform-registry'

/**
 * Endpoints to probe for a key. Custom platforms use credential.endpoints when set;
 * otherwise plan endpoints with per-endpoint overrides. Dual anthropic+openai plans
 * must never collapse to endpoints[0].
 */
export function planTestEndpoints(
  plan: Plan,
  overrides: Record<string, EndpointOverride> | undefined,
  opts?: { platform?: Platform; credential?: Pick<Credential, 'endpoints' | 'overrides'> },
): ServiceEndpoint[] {
  const baseList =
    opts?.platform
      ? effectiveEndpoints(opts.platform, plan, opts.credential ?? { overrides })
      : plan.endpoints
  return baseList.map((endpoint) => ({
    ...endpoint,
    // For custom keys endpoints already include overrides; re-merge is idempotent for baseUrl.
    baseUrl: mergeEndpoint(endpoint, overrides?.[endpoint.id]).baseUrl,
  }))
}

/** One endpoint with only its own override applied — used by per-endpoint test buttons. */
export function singleTestEndpoint(
  endpoint: ServiceEndpoint,
  override: EndpointOverride | undefined,
): ServiceEndpoint {
  return {
    ...endpoint,
    baseUrl: mergeEndpoint(endpoint, override).baseUrl,
  }
}

export function formatEndpointTestFailures(results: EndpointTestResult[]): string {
  return results
    .filter((r) => !r.success)
    .map((r) => `${r.endpointId}: ${r.error ?? (r.status != null ? `HTTP ${r.status}` : 'failed')}`)
    .join('; ')
}

export type EndpointTestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'success'; results: EndpointTestResult[] }
  | { status: 'error'; message: string; results: EndpointTestResult[] }

export function useEndpointTest() {
  const [state, setState] = useState<EndpointTestState>({ status: 'idle' })

  const run = useCallback(async (endpoints: ServiceEndpoint[], apiKey: string, credentialId?: string) => {
    if (endpoints.length === 0) {
      setState({ status: 'error', message: 'no endpoints', results: [] })
      return
    }
    setState({ status: 'testing' })
    try {
      const res = await window.app.testProviderEndpoint({ apiKey, credentialId, endpoints })
      if (res.success) {
        setState({ status: 'success', results: res.results })
      } else {
        setState({
          status: 'error',
          message: formatEndpointTestFailures(res.results) || 'failed',
          results: res.results,
        })
      }
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
        results: [],
      })
    }
  }, [])

  return { state, run, reset: () => setState({ status: 'idle' }) }
}
