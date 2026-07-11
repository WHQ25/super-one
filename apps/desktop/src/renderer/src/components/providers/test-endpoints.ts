import { useCallback, useState } from 'react'
import { mergeEndpoint, type EndpointOverride, type Plan, type ServiceEndpoint } from '@superone/shared/platform-registry'

export function planTestEndpoints(plan: Plan, overrides: Record<string, EndpointOverride> | undefined): ServiceEndpoint[] {
  const endpoint = plan.endpoints[0]
  if (!endpoint) return []
  return [{
    ...endpoint,
    baseUrl: mergeEndpoint(endpoint, overrides?.[endpoint.id]).baseUrl,
  }]
}

export type EndpointTestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'success' }
  | { status: 'error'; message: string }

export function useEndpointTest() {
  const [state, setState] = useState<EndpointTestState>({ status: 'idle' })

  const run = useCallback(async (endpoints: ServiceEndpoint[], apiKey: string, credentialId?: string) => {
    setState({ status: 'testing' })
    try {
      const res = await window.app.testProviderEndpoint({ apiKey, credentialId, endpoints })
      if (res.success) {
        setState({ status: 'success' })
      } else {
        setState({ status: 'error', message: res.results.find((r) => !r.success)?.error ?? '' })
      }
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  return { state, run, reset: () => setState({ status: 'idle' }) }
}
