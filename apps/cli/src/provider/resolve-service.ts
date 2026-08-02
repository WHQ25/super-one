/**
 * Resolve chat service env/models from node ProviderStore (no Electron).
 */

import {
  BUILTIN_PLATFORMS,
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
import type { ProviderStore } from './provider-store'

function credentialApiKey(cred: Credential): string {
  if (cred.secretEnv) return process.env[cred.secretEnv] ?? ''
  return cred.secret
}

export function platformsForNode(store: ProviderStore): Platform[] {
  const custom = store.listCustomPlatforms()
  const byId = new Map(BUILTIN_PLATFORMS.map((p) => [p.id, p]))
  for (const p of custom) byId.set(p.id, p)
  return [...byId.values()]
}

export function resolveServiceFromCredential(
  consumer: ConsumerId,
  cred: Credential,
  platforms: Platform[],
  binding?: { endpointId?: string; config?: Record<string, unknown> } | null,
): ResolvedService | null {
  const platform = findPlatform(platforms, cred.platformId)
  const plan = findPlan(platform, cred.planId)
  if (!platform || !plan) return null

  const endpoints = effectiveEndpoints(platform, plan, cred)
  const selected = selectEndpoint(
    plan,
    consumer,
    binding?.endpointId,
    cred,
    endpoints,
  )
  if (!selected) return null
  const { endpoint, protocol } = selected
  const merged = mergeEndpoint(
    endpoint,
    cred.overrides?.[endpoint.id],
    binding?.config as never,
  )

  const modelMapping =
    Object.keys(merged.modelMapping).length > 0
      ? merged.modelMapping
      : protocol === 'openai-chat'
        ? endpoints
            .filter((e) => e.protocols.includes('anthropic-messages'))
            .map((e) =>
              mergeEndpoint(e, cred.overrides?.[e.id], binding?.config as never).modelMapping,
            )
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

export function consumerForHarness(harness: string): ConsumerId | null {
  if (harness === 'claude') return 'chat:claude'
  if (harness === 'codex') return 'chat:codex'
  return null
}

/** Build process env for Claude / Codex from a resolved service. */
export function buildHarnessEnv(harness: string, resolved: ResolvedService | null): Record<string, string> {
  if (!resolved) return {}
  const env: Record<string, string> = { ...(resolved.extraEnv ?? {}) }
  if (harness === 'claude') {
    if (resolved.apiKey) {
      env.ANTHROPIC_API_KEY = resolved.apiKey
      if ('ANTHROPIC_AUTH_TOKEN' in env) env.ANTHROPIC_AUTH_TOKEN = resolved.apiKey
    }
    if (resolved.baseUrl) env.ANTHROPIC_BASE_URL = resolved.baseUrl
  } else if (harness === 'codex') {
    if (resolved.apiKey) {
      env.OPENAI_API_KEY = resolved.apiKey
      env.CODEX_API_KEY = resolved.apiKey
    }
    if (resolved.baseUrl) {
      env.OPENAI_BASE_URL = resolved.baseUrl
      env.CODEX_BASE_URL = resolved.baseUrl
    }
  }
  return env
}

/**
 * Resolve provider for a harness turn.
 * Prefer explicit apiProviderId; else consumer binding on the node.
 */
export function resolveHarnessService(
  store: ProviderStore,
  harness: string,
  apiProviderId?: string | null,
): ResolvedService | null {
  const consumer = consumerForHarness(harness)
  if (!consumer) return null
  const platforms = platformsForNode(store)
  const bindings = store.listBindings()
  const binding = bindings.find((b) => b.consumer === consumer)

  const tryId = apiProviderId?.trim() || binding?.credentialId
  if (!tryId) return null
  const cred = store.getCredentialDecrypted(tryId)
  if (!cred) return null
  return resolveServiceFromCredential(
    consumer,
    cred,
    platforms,
    binding && binding.credentialId === cred.id
      ? { endpointId: binding.endpointId, config: binding.config as never }
      : null,
  )
}

export interface ModelOptionWire {
  id: string
  name: string
  description: string
  isDefault?: boolean
  supportedEffortLevels?: string[]
  supportedReasoningEfforts?: Array<{ value: string }>
  defaultReasoningEffort?: string
}

/** Default Claude slugs when the node has no custom catalog. */
const DEFAULT_CLAUDE_MODELS: ModelOptionWire[] = [
  { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5', description: '', isDefault: true, supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
  { id: 'claude-opus-4-5', name: 'Opus 4.5', description: '', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
  { id: 'claude-haiku-4-5', name: 'Haiku 4.5', description: '', supportedEffortLevels: ['low', 'medium', 'high'] },
]

const DEFAULT_CODEX_MODELS: ModelOptionWire[] = [
  { id: 'gpt-5.2', name: 'GPT-5.2', description: '', isDefault: true },
  { id: 'gpt-5.1', name: 'GPT-5.1', description: '' },
  { id: 'o3', name: 'o3', description: '' },
]

export function listHarnessModels(
  store: ProviderStore,
  harness: string,
  apiProviderId?: string | null,
): ModelOptionWire[] {
  const resolved = resolveHarnessService(store, harness, apiProviderId)
  if (resolved) {
    const mapped = new Map<string, ModelOptionWire>()
    for (const m of resolved.models ?? []) {
      mapped.set(m.id, {
        id: m.id,
        name: m.name ?? m.id,
        description: '',
        isDefault: false,
      })
    }
    for (const slot of Object.values(resolved.modelMapping ?? {})) {
      if (!slot?.id) continue
      const id = slot.id.replace(/\[1m\]/i, '')
      if (!mapped.has(id)) {
        mapped.set(id, {
          id,
          name: slot.name?.replace(/\[1m\]/i, '').trim() || id,
          description: '',
          isDefault: true,
        })
      } else {
        const prev = mapped.get(id)!
        mapped.set(id, { ...prev, isDefault: true, name: slot.name || prev.name })
      }
    }
    const list = [...mapped.values()]
    if (list.length > 0) return list
  }
  if (harness === 'claude') return DEFAULT_CLAUDE_MODELS
  if (harness === 'codex') return DEFAULT_CODEX_MODELS
  return []
}
