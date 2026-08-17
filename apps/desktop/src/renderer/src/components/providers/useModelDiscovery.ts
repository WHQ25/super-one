import { useCallback, useMemo, useState } from 'react'
import type { DiscoveredExtraProtocol, DiscoveredOpenAiModel, RelayFingerprint } from '@superone/shared/agent-types'
import {
  effectiveEndpoints,
  familyBaseUrl,
  isCustomPlatform,
  mergeEndpoint,
  relaySiteRoot,
  type Credential,
  type EndpointOverride,
  type Plan,
  type Platform,
  type ServiceEndpoint,
} from '@superone/shared/platform-registry'
import {
  applyDiscoveredModels,
  cachedDiscoveredModels,
  discoveryEndpoint,
  widenedPlanEndpoints,
} from './discovery-apply'

export type DiscoverState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; truncated: boolean }
  | { status: 'error'; message: string }

function siteRootFrom(baseUrl: string): string {
  return relaySiteRoot(baseUrl)
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
  const custom = isCustomPlatform(platform)
  const liveEndpoints = useMemo(
    () => effectiveEndpoints(platform, plan, credential),
    [platform, plan, credential],
  )
  const [discovered, setDiscovered] = useState<DiscoveredOpenAiModel[]>(() =>
    custom ? cachedDiscoveredModels(platform.discoveredModels, liveEndpoints) : [],
  )
  const [extras, setExtras] = useState<DiscoveredExtraProtocol[]>([])
  const [relay, setRelay] = useState<RelayFingerprint | undefined>()
  const [state, setState] = useState<DiscoverState>({ status: 'idle' })
  const livePlan = useMemo(() => ({ ...plan, endpoints: liveEndpoints }), [plan, liveEndpoints])
  const endpoint = discoveryEndpoint(livePlan)

  const persistDiscovered = useCallback(
    async (models: DiscoveredOpenAiModel[]) => {
      if (!custom) return
      if (JSON.stringify(platform.discoveredModels ?? []) === JSON.stringify(models)) return
      await updateCustomPlatform({ ...platform, discoveredModels: models })
    },
    [custom, platform, updateCustomPlatform],
  )

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
      setExtras(result.extras ?? [])
      setRelay(result.relay)
      const siteRoot = endpointsSiteRoot(liveEndpoints, effectiveBaseUrl)
      const widened = widenedPlanEndpoints(livePlan, siteRoot, result.models, result.extras)
      if (custom) {
        await persistDiscovered(result.models)
        if (widened) await updateCredential(credential.id, { endpoints: widened })
      }
      setState({ status: 'done', truncated: result.truncated })
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [endpoint, credential, liveEndpoints, livePlan, custom, persistDiscovered, updateCredential])

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
      const widenedEndpoints = widenedPlanEndpoints(livePlan, siteRoot, models, extras)

      if (custom) {
        const nextEndpoints = widenedEndpoints ?? liveEndpoints
        const nextPlan = { ...plan, endpoints: nextEndpoints }
        const overrides = applyDiscoveredModels(credential.overrides, nextPlan, models)
        // Fold enabled models into the key's endpoint list.
        const folded = nextEndpoints.map((e) => {
          const ov = overrides[e.id]
          if (!ov?.models) return e
          const incomingIds = new Set(ov.models.map((m) => m.id))
          const kept = (e.models ?? []).filter((m) => !incomingIds.has(m.id))
          return { ...e, models: [...kept, ...ov.models] }
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
    [credential, endpoint, liveEndpoints, livePlan, plan, platform, custom, extras, updateCredential, updateCustomPlatform],
  )

  const patchDiscovered = useCallback((model: DiscoveredOpenAiModel) => {
    setDiscovered((prev) => {
      const next = prev.map((m) => (m.id === model.id ? model : m))
      void persistDiscovered(next)
      return next
    })
  }, [persistDiscovered])

  const replaceDiscovered = useCallback((models: DiscoveredOpenAiModel[]) => {
    setDiscovered(models)
  }, [])

  return { endpoint, discovered, extras, relay, state, discover, enableModels, patchDiscovered, replaceDiscovered }
}
