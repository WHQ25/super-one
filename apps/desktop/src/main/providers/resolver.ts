import { expandProviderModelEnv, type EffortLevel, type RemoteActiveProvider } from '@superone/shared/agent-types'
import {
  CONSUMER_TASK,
  effectiveEndpoints,
  familyBaseUrl,
  findPlan,
  findPlatform,
  mergeEndpoint,
  PROTOCOL_FAMILY,
  selectEndpoint,
  type ConsumerId,
  type Credential,
  type Platform,
  type ResolvedService,
} from '@superone/shared/platform-registry'
import { getBinding, getCredentialDecrypted } from './credential-store'
import { getPlatforms } from './registry'

export interface ResolveOverride {
  credentialId?: string | null
  experimentalClaudeOpenAiChatEnabled?: boolean
}

function credentialApiKey(cred: Credential): string {
  if (cred.secretEnv) return process.env[cred.secretEnv] ?? ''
  return cred.secret
}

/**
 * Single resolution entry point for every consumer.
 * Pipeline: session/global binding → credential → registry platform/plan → endpoint for the task →
 * merge endpoint.defaults ← credential.overrides ← binding.config.
 *
 * Dynamic-follow: an explicit override.credentialId that no longer resolves falls back to the global binding.
 */
export function resolveService(consumer: ConsumerId, override?: ResolveOverride): ResolvedService | null {
  const binding = getBinding(consumer)

  const tryCredential = (id: string | null | undefined): Credential | undefined =>
    id ? getCredentialDecrypted(id) : undefined

  const cred =
    tryCredential(override?.credentialId) ?? tryCredential(binding?.credentialId)
  if (!cred) return null

  const platforms = getPlatforms()
  const platform = findPlatform(platforms, cred.platformId)
  const plan = findPlan(platform, cred.planId)
  if (!platform || !plan) return null

  // Only honor the binding's endpointId when this credential is the bound one.
  const usingBoundCredential = cred.id === binding?.credentialId
  const endpoints = effectiveEndpoints(platform, plan, cred)
  const selected = selectEndpoint(
    plan,
    consumer,
    usingBoundCredential ? binding?.endpointId : undefined,
    cred,
    endpoints,
    { experimentalClaudeOpenAiChatEnabled: override?.experimentalClaudeOpenAiChatEnabled },
  )
  if (!selected) return null
  const { endpoint, protocol } = selected

  // Custom keys with credential.endpoints already folded overrides in; still allow binding.config merge.
  const merged = mergeEndpoint(endpoint, cred.overrides?.[endpoint.id], usingBoundCredential ? binding?.config : undefined)

  const modelMapping = Object.keys(merged.modelMapping).length > 0
    ? merged.modelMapping
    : protocol === 'openai-chat'
      ? endpoints
          .filter((e) => e.protocols.includes('anthropic-messages'))
          .map((e) => mergeEndpoint(e, cred.overrides?.[e.id], usingBoundCredential ? binding?.config : undefined).modelMapping)
          .find((m) => Object.keys(m).length > 0)
      : undefined

  return {
    platformId: platform.id,
    brand: platform.brand,
    planId: plan.id,
    endpointId: endpoint.id,
    credentialId: cred.id,
    task: CONSUMER_TASK[consumer],
    protocol,
    baseUrl: familyBaseUrl(PROTOCOL_FAMILY[protocol], merged.baseUrl),
    apiKey: credentialApiKey(cred),
    auth: plan.auth,
    models: merged.models,
    modelMapping: modelMapping && Object.keys(modelMapping).length > 0 ? modelMapping : undefined,
    extraEnv: Object.keys(merged.extraEnv).length > 0 ? merged.extraEnv : undefined,
  }
}

export function resolveChatService(
  harness: 'claude' | 'codex',
  credentialId?: string | null,
  options?: { experimentalClaudeOpenAiChatEnabled?: boolean },
): ResolvedService | null {
  return resolveService(harness === 'codex' ? 'chat:codex' : 'chat:claude', {
    credentialId,
    experimentalClaudeOpenAiChatEnabled: options?.experimentalClaudeOpenAiChatEnabled,
  })
}

/**
 * Resolve a chat service from an already-decrypted credential (e.g. loaded from a remote node).
 * Does not read the local credential store.
 */
export function resolveServiceFromCredential(
  consumer: ConsumerId,
  cred: Credential,
  binding?: { endpointId?: string; config?: { forcedEffort?: EffortLevel | 'auto'; modelMapping?: ResolvedService['modelMapping'] } } | null,
  options?: { experimentalClaudeOpenAiChatEnabled?: boolean },
): ResolvedService | null {
  const platforms = getPlatforms()
  const platform = findPlatform(platforms, cred.platformId)
  const plan = findPlan(platform, cred.planId)
  if (!platform || !plan) return null

  const endpoints = effectiveEndpoints(platform, plan, cred)
  const selected = selectEndpoint(plan, consumer, binding?.endpointId, cred, endpoints, options)
  if (!selected) return null
  const { endpoint, protocol } = selected
  const merged = mergeEndpoint(endpoint, cred.overrides?.[endpoint.id], binding?.config)

  const modelMapping = Object.keys(merged.modelMapping).length > 0
    ? merged.modelMapping
    : protocol === 'openai-chat'
      ? endpoints
          .filter((e) => e.protocols.includes('anthropic-messages'))
          .map((e) => mergeEndpoint(e, cred.overrides?.[e.id], binding?.config).modelMapping)
          .find((m) => Object.keys(m).length > 0)
      : undefined

  return {
    platformId: platform.id,
    brand: platform.brand,
    planId: plan.id,
    endpointId: endpoint.id,
    credentialId: cred.id,
    task: CONSUMER_TASK[consumer],
    protocol,
    baseUrl: familyBaseUrl(PROTOCOL_FAMILY[protocol], merged.baseUrl),
    apiKey: credentialApiKey(cred),
    auth: plan.auth,
    models: merged.models,
    modelMapping: modelMapping && Object.keys(modelMapping).length > 0 ? modelMapping : undefined,
    extraEnv: Object.keys(merged.extraEnv).length > 0 ? merged.extraEnv : undefined,
  }
}

// --- adapters ----------------------------------------------------------------

/** anthropic-messages:chat → Claude harness env expansion. */
export function buildClaudeEnv(resolved: ResolvedService | null): Record<string, string> {
  if (!resolved) return {}
  const env: Record<string, string> = {
    ...(resolved.extraEnv ?? {}),
    ...expandProviderModelEnv(resolved.modelMapping ?? {}),
  }
  if (resolved.apiKey) {
    env.ANTHROPIC_API_KEY = resolved.apiKey
    if ('ANTHROPIC_AUTH_TOKEN' in env) env.ANTHROPIC_AUTH_TOKEN = resolved.apiKey
  }
  if (resolved.baseUrl) env.ANTHROPIC_BASE_URL = resolved.baseUrl
  return env
}

function parseForcedEffort(extraEnv: Record<string, string> | undefined): EffortLevel | 'auto' | null {
  const raw = (extraEnv?.CLAUDE_CODE_EFFORT_LEVEL ?? '').toLowerCase().trim()
  if (!raw) return null
  if (raw === 'auto') return 'auto'
  if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'xhigh' || raw === 'max') return raw
  return null
}

function platformName(platformId: string): string {
  return findPlatform(getPlatforms(), platformId)?.name ?? platformId
}

/** Build the mobile-facing active-provider descriptor from a resolved chat service (replaces buildRemoteActiveProvider). */
export function buildRemoteActiveService(
  resolved: ResolvedService | null,
  harness: 'claude' | 'codex' = 'claude',
): RemoteActiveProvider | null {
  if (!resolved) return null
  return {
    id: resolved.credentialId,
    name: credentialDisplayName(resolved),
    presetKey: resolved.brand,
    modelEnv: resolved.modelMapping ?? {},
    forcedEffort: harness === 'claude' ? parseForcedEffort(resolved.extraEnv) : null,
  }
}

function credentialDisplayName(resolved: ResolvedService): string {
  const cred = getCredentialDecrypted(resolved.credentialId)
  const base = platformName(resolved.platformId)
  if (cred?.name && cred.name !== base) return `${base} · ${cred.name}`
  return base
}

export type { Platform }
