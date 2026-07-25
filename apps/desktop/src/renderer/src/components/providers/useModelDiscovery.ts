import { useCallback, useMemo, useState } from 'react'
import type { DiscoveredOpenAiModel } from '@superone/shared/agent-types'
import {
  effectiveEndpoints,
  familyBaseUrl,
  isCustomPlatform,
  mergeEndpoint,
  type Credential,
  type EndpointOverride,
  type Plan,
  type Platform,
  type ServiceEndpoint,
} from '@superone/shared/platform-registry'
import { applyDiscoveredModels, discoveryEndpoint, widenedPlanEndpoints } from './discovery-apply'

export type DiscoverState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; truncated: boolean }
  | { status: 'error'; message: string }

function siteRootFrom(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v\d+$/, '')
}

function endpointsSiteRoot(endpoints: ServiceEndpoint[], probeBaseUrl?: string): string {
  if (probeBaseUrl) return siteRootFrom(probeBaseUrl)
  const first = endpoints[0]
  return first ? siteRootFrom(first.baseUrl) : ''
}

/**
 * Relay model discovery: one OpenAI-format `/v1/models` probe. For custom platforms, enabling
 * models widens/writes `credential.endpoints` (per-key). Builtin still uses plan + overrides.
 */
export function useModelDiscovery({
  platform,
  plan,
  credential,
  updateCredential,
  updateCustomPlatform,
}: {
  platform: Platform
  plan: Plan
  credential: Credential | undefined
  updateCredential: (
    id: string,
    patch: { overrides?: Record<string, EndpointOverride>; endpoints?: ServiceEndpoint[] },
  ) => Promise<void>
  updateCustomPlatform: (def: Platform) => Promise<void>
}) {
  const [discovered, setDiscovered] = useState<DiscoveredOpenAiModel[]>([])
  const [state, setState] = useState<DiscoverState>({ status: 'idle' })
  const custom = isCustomPlatform(platform)

  const liveEndpoints = useMemo(
    () => effectiveEndpoints(platform, plan, credential),
    [platform, plan, credential],
  )
  const livePlan = useMemo(() => ({ ...plan, endpoints: liveEndpoints }), [plan, liveEndpoints])
  const endpoint = discoveryEndpoint(livePlan)

  const discover = useCallback(async () => {
    if (!endpoint || !credential) return
    setState({ status: 'loading' })
    try {
      const existing = liveEndpoints.find((e) => e.id === endpoint.id)
      const effectiveBaseUrl = existing
        ? mergeEndpoint(existing, credential.overrides?.[existing.id]).baseUrl
        : endpoint.baseUrl
      const result = await window.app.discoverProviderModels({
        apiKey: '',
        credentialId: credential.id,
        endpoint: { ...endpoint, baseUrl: effectiveBaseUrl },
      })
      setDiscovered(result.models)
      setState({ status: 'done', truncated: result.truncated })
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [endpoint, credential, liveEndpoints])

  const enableModels = useCallback(
    async (models: DiscoveredOpenAiModel[]) => {
      if (!credential || models.length === 0) return
      const probeBase = endpoint
        ? (liveEndpoints.find((e) => e.id === endpoint.id)
            ? mergeEndpoint(
                liveEndpoints.find((e) => e.id === endpoint.id)!,
                credential.overrides?.[endpoint.id],
              ).baseUrl
            : endpoint.baseUrl)
        : familyBaseUrl('openai', endpointsSiteRoot(liveEndpoints))
      const siteRoot = endpointsSiteRoot(liveEndpoints, probeBase)
      const widenedEndpoints = widenedPlanEndpoints(livePlan, siteRoot, models)

      if (custom) {
        const nextEndpoints = widenedEndpoints ?? liveEndpoints
        const nextPlan = { ...plan, endpoints: nextEndpoints }
        const overrides = applyDiscoveredModels(credential.overrides, nextPlan, models)
        // Fold enabled models into the key's endpoint list.
        const folded = nextEndpoints.map((e) => {
          const ov = overrides[e.id]
          if (!ov?.models) return e
          return { ...e, models: ov.models }
        })
        await updateCredential(credential.id, { endpoints: folded, overrides: {} })
        return
      }

      let effectivePlan = plan
      if (widenedEndpoints) {
        effectivePlan = { ...plan, endpoints: widenedEndpoints }
        const nextPlatform: Platform = {
          ...platform,
          plans: platform.plans.map((p) => (p.id === plan.id ? effectivePlan : p)),
        }
        await updateCustomPlatform(nextPlatform)
      }

      const overrides = applyDiscoveredModels(credential.overrides, effectivePlan, models)
      await updateCredential(credential.id, { overrides })
    },
    [credential, endpoint, liveEndpoints, livePlan, plan, platform, custom, updateCredential, updateCustomPlatform],
  )

  return { endpoint, discovered, state, discover, enableModels }
}
