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
 * Endpoints for Connection Test. Custom platforms use credential.endpoints when set;
 * otherwise plan endpoints with per-endpoint overrides. The main process selects one
 * preferred auth surface (openai → google → anthropic) so dual-protocol plans are not
 * failed by a sibling that lacks GET /v1/models.
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
  return baseList.map((endpoint) => applyOverride(endpoint, overrides?.[endpoint.id]))
}

/** One endpoint with only its own override applied — used by per-endpoint test buttons. */
export function singleTestEndpoint(
  endpoint: ServiceEndpoint,
  override: EndpointOverride | undefined,
): ServiceEndpoint {
  return applyOverride(endpoint, override)
}

/**
 * Fold one override onto an endpoint for probing. Both the host override and the per-protocol
 * routes have to survive — the probe URL is built from the site root plus the endpoint's route,
 * so dropping either one silently tests a different address than the harness will use.
 * For custom keys the endpoint already carries the override; re-merging is idempotent.
 */
function applyOverride(endpoint: ServiceEndpoint, override: EndpointOverride | undefined): ServiceEndpoint {
  const merged = mergeEndpoint(endpoint, override)
  const next: ServiceEndpoint = { ...endpoint }
  if (merged.baseUrl) next.baseUrl = merged.baseUrl
  else delete next.baseUrl
  if (merged.routes) next.routes = merged.routes
  else delete next.routes
  return next
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

  const run = useCallback(async (
    siteRoot: string,
    endpoints: ServiceEndpoint[],
    apiKey: string,
    credentialId?: string,
  ) => {
    if (endpoints.length === 0) {
      setState({ status: 'error', message: 'no endpoints', results: [] })
      return
    }
    setState({ status: 'testing' })
    try {
      const res = await window.app.testProviderEndpoint({ apiKey, credentialId, baseUrl: siteRoot, endpoints })
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
