import type { HarnessId, ProviderModelEnv } from '@superone/shared/agent-types'
import {
  CONSUMER_IDS,
  effectiveEndpoints,
  findPlan,
  findPlatform,
  mergeEndpoint,
  selectEndpoint,
  type ConsumerBinding,
  type ConsumerId,
  type Credential,
  type Platform,
  type ServiceEndpoint,
} from '@superone/shared/platform-registry'

export interface ProviderResolveOptions {
  experimentalClaudeOpenAiChatEnabled?: boolean
}

export function consumerForHarness(harness: HarnessId): ConsumerId {
  if (harness === 'codex') return 'chat:codex'
  return 'chat:claude'
}

export interface EffectiveService {
  credential: Credential
  platform: Platform
  planId: string
  endpointId: string
  brand: string
  baseUrl: string
  modelMapping: ProviderModelEnv
  extraEnv: Record<string, string>
  endpoints: ServiceEndpoint[]
}

/** Credentials whose plan/key can serve the given consumer (i.e. has a matching endpoint). */
export function credentialsForConsumer(
  platforms: Platform[],
  credentials: Credential[],
  consumer: ConsumerId,
  options?: ProviderResolveOptions,
): Credential[] {
  return credentials.filter((c) => {
    const platform = findPlatform(platforms, c.platformId)
    const plan = findPlan(platform, c.planId)
    if (!platform || !plan) return false
    const endpoints = effectiveEndpoints(platform, plan, c)
    return !!selectEndpoint(plan, consumer, undefined, c, endpoints, options)
  })
}

/**
 * Renderer mirror of the main-process resolver's selection logic (no secrets).
 * sessionCredentialId (an explicit in-chat switch) wins over the global binding; a stale id falls back.
 */
export function resolveEffective(
  platforms: Platform[],
  credentials: Credential[],
  bindings: ConsumerBinding[],
  consumer: ConsumerId,
  sessionCredentialId?: string | null,
  options?: ProviderResolveOptions,
): EffectiveService | null {
  const binding = bindings.find((b) => b.consumer === consumer)
  const pick = (id: string | null | undefined): Credential | undefined =>
    id ? credentials.find((c) => c.id === id) : undefined
  const cred = pick(sessionCredentialId) ?? pick(binding?.credentialId)
  if (!cred) return null
  const platform = findPlatform(platforms, cred.platformId)
  const plan = findPlan(platform, cred.planId)
  if (!platform || !plan) return null
  const usingBound = cred.id === binding?.credentialId
  const endpoints = effectiveEndpoints(platform, plan, cred)
  const selected = selectEndpoint(
    plan,
    consumer,
    usingBound ? binding?.endpointId : undefined,
    cred,
    endpoints,
    options,
  )
  if (!selected) return null
  const { endpoint } = selected
  const merged = mergeEndpoint(endpoint, cred.overrides?.[endpoint.id], usingBound ? binding?.config : undefined)
  return {
    credential: cred,
    platform,
    planId: plan.id,
    endpointId: endpoint.id,
    brand: platform.brand,
    baseUrl: merged.baseUrl,
    modelMapping: merged.modelMapping,
    extraEnv: merged.extraEnv,
    endpoints,
  }
}

export function brandOfCredential(platforms: Platform[], credential: Credential): string | null {
  return findPlatform(platforms, credential.platformId)?.brand ?? null
}

/** Consumers this platform can serve (has at least one matching endpoint across its plans). */
export function platformConsumers(platform: Platform): ConsumerId[] {
  return CONSUMER_IDS.filter((consumer) => platform.plans.some((plan) => !!selectEndpoint(plan, consumer)))
}

/** Group platforms by brand for the settings list (stable insertion order). */
export function platformsByBrand(platforms: Platform[]): Array<{ brand: string; platforms: Platform[] }> {
  const groups = new Map<string, Platform[]>()
  for (const p of platforms) {
    const list = groups.get(p.brand) ?? []
    list.push(p)
    groups.set(p.brand, list)
  }
  return [...groups.entries()].map(([brand, ps]) => ({ brand, platforms: ps }))
}
