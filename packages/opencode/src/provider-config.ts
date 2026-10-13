import { createHash } from 'node:crypto'
import type { ResolvedService } from '@superone/shared/platform-registry'

const PACKAGES = {
  'openai-chat': '@opencode/ai/providers/openai-compatible',
  'openai-responses': '@opencode/ai/providers/openai-compatible/responses',
  'anthropic-messages': '@opencode/ai/providers/anthropic-compatible',
} as const

/** Process-only configuration: API keys never enter a project file or native account store. */
export function openCodeProviderConfig(service: ResolvedService, baseConfig = '{}') {
  const packageName = PACKAGES[service.protocol as keyof typeof PACKAGES]
  if (!packageName || service.auth !== 'api-key' || !service.apiKey)
    throw new Error('OpenCode requires a usable API key and a supported chat protocol')
  const providerId = `superone_node_${createHash('sha256').update(service.credentialId).digest('hex').slice(0, 16)}`
  const ids = new Map((service.models ?? []).map(model => [model.id, model.name ?? model.id]))
  for (const model of Object.values(service.modelMapping ?? {})) if (model?.id) {
    const id = model.id.replace(/\[1m\]/i, '')
    ids.set(id, model.name || id)
  }
  if (!ids.size) throw new Error('Configure at least one model for this OpenCode provider')
  const modelId = (id: string) => `${providerId}/${id}`
  const defaultModel = modelId(ids.keys().next().value!)
  const keyEnv = 'SUPERONE_OPENCODE_PROVIDER_KEY'
  const config = JSON.parse(baseConfig)
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid OpenCode launch configuration')
  const env = { ...(service.extraEnv ?? {}), [keyEnv]: service.apiKey, OPENCODE_CONFIG_CONTENT: JSON.stringify({
    ...config,
    model: defaultModel,
    providers: { ...config.providers, [providerId]: { name: service.brand || 'SuperOne',
      package: packageName, env: [keyEnv], settings: { baseURL: service.baseUrl },
      models: Object.fromEntries([...ids].map(([id, name]) => [id, { modelID: id, name, capabilities: { tools: true } }])),
    } },
  }) }
  return { env, models: [...ids].map(([id, name]) => ({ id: modelId(id), name, providerName: service.brand || 'SuperOne', description: service.brand || '', isDefault: modelId(id) === defaultModel })),
    mapModel(selected?: string | null) {
      if (!selected?.trim()) return defaultModel
      const value = selected.trim(), raw = value.startsWith(`${providerId}/`) ? value.slice(providerId.length + 1) : value
      if (!ids.has(raw)) throw new Error('Selected model is unavailable for this OpenCode provider; select a model from its catalog')
      return modelId(raw)
    },
  }
}
