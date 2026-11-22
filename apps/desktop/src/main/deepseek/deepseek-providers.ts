import { resolvePiAiModelDefaults, type PiAiProviderProfile } from '@superone/deepseek'
import type { CatalogModel, ModelCatalog } from '@superone/shared/model-catalog-types'
import {
  catalogProviderFor,
  catalogProviderIdFor,
  classifyModelById,
  effectiveEndpoints,
  findPlan,
  findPlatform,
  resolveEndpointModels,
  type EndpointModel,
  type WireProtocol,
} from '@superone/shared/platform-registry'
import { getModelCatalog } from '../model-catalog'
import { listCredentials } from '../providers/credential-store'
import { getPlatforms } from '../providers/registry'
import { resolveService } from '../providers/resolver'
import { dshCredentialRefForId, resolveDeepseekApiKey } from './deepseek-credentials'

export const DEEPSEEK_OFFICIAL_PROVIDER = 'deepseek-official'
export const DEEPSEEK_OFFICIAL_DEFAULT_MODEL = 'deepseek-v4-pro'

const PI_AI_API_MAP: Partial<Record<WireProtocol, string>> = {
  'openai-chat': 'openai-completions',
  'openai-responses': 'openai-responses',
  'anthropic-messages': 'anthropic-messages',
  'google-generative': 'google-generative-ai',
}

const DEFAULT_BASE_URLS: Partial<Record<WireProtocol, string>> = {
  'openai-chat': 'https://api.openai.com/v1',
  'openai-responses': 'https://api.openai.com/v1',
  'anthropic-messages': 'https://api.anthropic.com',
  'google-generative': 'https://generativelanguage.googleapis.com/v1beta',
}

export function dshProviderRouteForCredential(credentialId: string): string {
  return `superone-${credentialId}`
}

function isDshChatModel(m: EndpointModel, cm?: CatalogModel): boolean {
  if (m.tasks && !m.tasks.includes('chat')) return false
  if (cm) {
    if (!cm.outputModalities.includes('text')) return false
    if (cm.outputModalities.includes('image') || cm.outputModalities.includes('video') || cm.outputModalities.includes('audio')) {
      return false
    }
  }
  if (!m.tasks) {
    const classified = Object.values(classifyModelById(m.id)).flat()
    if (classified.length > 0 && !classified.includes('chat')) return false
  }
  return true
}

const DEFAULT_PI_AI_REASONING_EFFORTS = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'max',
} as const

export interface DshRouteResolution {
  provider: string
  defaultModel?: string
  credentialId?: string
}

export function resolveDshRoute(apiProviderId?: string | null): DshRouteResolution {
  let resolved = resolveService('chat:dsh', { credentialId: apiProviderId })
  if (!resolved && !apiProviderId && !resolveDeepseekApiKey()) {
    for (const cred of listCredentials()) {
      const candidate = resolveService('chat:dsh', { credentialId: cred.id })
      if (candidate) {
        resolved = candidate
        break
      }
    }
  }
  if (!resolved) {
    return {
      provider: DEEPSEEK_OFFICIAL_PROVIDER,
      defaultModel: DEEPSEEK_OFFICIAL_DEFAULT_MODEL,
    }
  }
  return {
    provider: dshProviderRouteForCredential(resolved.credentialId),
    defaultModel: resolved.models[0]?.id,
    credentialId: resolved.credentialId,
  }
}

export async function buildDshPiAiProviders(): Promise<Record<string, PiAiProviderProfile>> {
  const catalog = await getModelCatalog().catch(() => undefined)
  return buildDshPiAiProvidersSync(catalog)
}

export function buildDshPiAiProvidersSync(catalog?: ModelCatalog): Record<string, PiAiProviderProfile> {
  const platforms = getPlatforms()
  const out: Record<string, PiAiProviderProfile> = {}

  for (const cred of listCredentials()) {
    const resolved = resolveService('chat:dsh', { credentialId: cred.id })
    if (!resolved) continue
    const api = PI_AI_API_MAP[resolved.protocol]
    if (!api) continue
    const baseURL = resolved.baseUrl || DEFAULT_BASE_URLS[resolved.protocol]
    if (!baseURL) continue

    const platform = findPlatform(platforms, cred.platformId)
    const plan = findPlan(platform, cred.planId)
    if (!platform || !plan) continue

    const endpoint = effectiveEndpoints(platform, plan, cred).find((e) => e.id === resolved.endpointId)
    const endpointModels = resolved.models.length > 0
      ? resolved.models
      : endpoint
        ? resolveEndpointModels(platform, plan, endpoint, catalog)
        : []

    const catalogById = new Map<string, CatalogModel>()
    for (const m of catalogProviderFor(platform, plan, catalog)?.models ?? []) {
      catalogById.set(m.id, m)
    }

    const catalogProviderId = catalogProviderIdFor(platform, plan)
    const models = endpointModels
      .filter((m) => isDshChatModel(m, catalogById.get(m.id)))
      .map((m) => {
        const cm = catalogById.get(m.id)
        const piAi = resolvePiAiModelDefaults(m.id, catalogProviderId)
        const input: Array<'text' | 'image'> = piAi?.input
          ?? (cm?.inputModalities.includes('image') ? ['text', 'image'] : ['text'])
        const contextWindow = cm?.contextWindow && cm.contextWindow > 0 ? cm.contextWindow : piAi?.contextWindow
        const maxTokens = cm?.maxOutput && cm.maxOutput > 0 ? cm.maxOutput : piAi?.maxTokens
        const reasoningEfforts = piAi?.reasoningEfforts !== undefined
          ? piAi.reasoningEfforts
          : cm?.reasoning === true
            ? DEFAULT_PI_AI_REASONING_EFFORTS
            : cm?.reasoning === false
              ? (false as const)
              : undefined
        return {
          id: m.id,
          name: m.name || cm?.name || m.id,
          ...(contextWindow && contextWindow > 0 ? { contextWindow } : {}),
          ...(maxTokens && maxTokens > 0 ? { maxTokens } : {}),
          input,
          ...(reasoningEfforts !== undefined ? { reasoningEfforts } : {}),
        }
      })

    if (models.length === 0) continue

    const route = dshProviderRouteForCredential(cred.id)
    out[route] = {
      displayName: `${platform.name} (${cred.name})`,
      apiKeyEnv: dshCredentialRefForId(cred.id),
      api,
      baseURL,
      models,
    }
  }

  return out
}
