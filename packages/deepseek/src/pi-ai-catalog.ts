import { getSupportedThinkingLevels, type Api, type Model } from '@earendil-works/pi-ai'
import { builtinProviders, getAllBuiltinModels, type BuiltinProvider } from '@earendil-works/pi-ai/providers/all'
import type { PiAiModality, PiAiReasoningEfforts } from '@deepseek-ai/dsh-llm-pi-ai'

export interface PiAiModelDefaults {
  contextWindow?: number
  maxTokens?: number
  input?: PiAiModality[]
  reasoningEfforts: false | PiAiReasoningEfforts
}

const ALL_BUILTIN_PROVIDERS = Object.keys(builtinProviders) as BuiltinProvider[]
let cachedByProvider: Map<string, Map<string, Model<Api>>> | null = null

function ensureIndex(): Map<string, Map<string, Model<Api>>> {
  if (cachedByProvider) return cachedByProvider
  const map = new Map<string, Map<string, Model<Api>>>()
  for (const provider of ALL_BUILTIN_PROVIDERS) {
    const models = new Map<string, Model<Api>>()
    for (const model of getAllBuiltinModels(provider)) {
      models.set(model.id, model as Model<Api>)
    }
    map.set(provider, models)
  }
  cachedByProvider = map
  return map
}

function findBuiltinModel(modelId: string, catalogProviderId?: string): Model<Api> | undefined {
  const index = ensureIndex()
  const bare = modelId.includes('/') ? modelId.slice(modelId.indexOf('/') + 1) : modelId
  if (catalogProviderId) {
    const bucket = index.get(catalogProviderId)
    const hit = bucket?.get(modelId) ?? bucket?.get(bare)
    if (hit) return hit
  }
  for (const bucket of index.values()) {
    const hit = bucket.get(modelId) ?? bucket.get(bare)
    if (hit) return hit
  }
  return undefined
}

export function resolvePiAiModelDefaults(modelId: string, catalogProviderId?: string): PiAiModelDefaults | undefined {
  const model = findBuiltinModel(modelId, catalogProviderId)
  if (!model) return undefined

  let reasoningEfforts: false | PiAiReasoningEfforts = false
  if (model.reasoning) {
    const efforts: PiAiReasoningEfforts = {}
    for (const level of getSupportedThinkingLevels(model)) {
      if (level !== 'off') efforts[level] = level
    }
    reasoningEfforts = Object.keys(efforts).length > 0 ? efforts : false
  }

  return {
    ...(model.contextWindow > 0 ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens > 0 ? { maxTokens: model.maxTokens } : {}),
    ...(model.input.length > 0 ? { input: [...model.input] } : {}),
    reasoningEfforts,
  }
}
