import { useCallback, useState } from 'react'
import type { DiscoveredOpenAiModel } from '@superone/shared/agent-types'
import { familyBaseUrl, mergeEndpoint, type Credential, type EndpointOverride, type Plan, type Platform } from '@superone/shared/platform-registry'
import { applyDiscoveredModels, discoveryEndpoint, widenedPlanEndpoints } from './discovery-apply'

export type DiscoverState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; truncated: boolean }
  | { status: 'error'; message: string }

function siteRootFrom(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v\d+$/, '')
}

/** Site root for synthesizing family base URLs when widening endpoints. */
function planSiteRoot(plan: Plan, probeBaseUrl?: string): string {
  if (probeBaseUrl) return siteRootFrom(probeBaseUrl)
  const first = plan.endpoints[0]
  return first ? siteRootFrom(first.baseUrl) : ''
}

/**
 * Relay model discovery for a custom platform's plan: one OpenAI-format `/v1/models` probe (via
 * `providers:discover-models`) tags models with per-family capabilities. Enabling silently widens
 * endpoints for openai/anthropic/google as needed (additive only) via `updateCustomPlatform` before
 * writing models onto the matching family endpoint via `updateCredential`.
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
  updateCredential: (id: string, patch: { overrides?: Record<string, EndpointOverride> }) => Promise<void>
  updateCustomPlatform: (def: Platform) => Promise<void>
}) {
  const [discovered, setDiscovered] = useState<DiscoveredOpenAiModel[]>([])
  const [state, setState] = useState<DiscoverState>({ status: 'idle' })

  const endpoint = discoveryEndpoint(plan)

  const discover = useCallback(async () => {
    if (!endpoint || !credential) return
    setState({ status: 'loading' })
    try {
      const existing = plan.endpoints.find((e) => e.id === endpoint.id)
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
  }, [endpoint, credential, plan.endpoints])

  const enableModels = useCallback(
    async (models: DiscoveredOpenAiModel[]) => {
      if (!credential || models.length === 0) return
      const probeBase = endpoint
        ? (plan.endpoints.find((e) => e.id === endpoint.id)
            ? mergeEndpoint(
                plan.endpoints.find((e) => e.id === endpoint.id)!,
                credential.overrides?.[endpoint.id],
              ).baseUrl
            : endpoint.baseUrl)
        : familyBaseUrl('openai', planSiteRoot(plan))
      const siteRoot = planSiteRoot(plan, probeBase)
      const widenedEndpoints = widenedPlanEndpoints(plan, siteRoot, models)

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
    [credential, endpoint, plan, platform, updateCredential, updateCustomPlatform],
  )

  return { endpoint, discovered, state, discover, enableModels }
}
