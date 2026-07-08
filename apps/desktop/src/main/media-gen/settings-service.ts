import type { MediaProviderStatus, ProviderCapability, UpsertMediaProviderRequest } from '@superone/shared/agent-types'
import {
  IMAGE_PROTOCOL_TO_MEDIA_KIND,
  MEDIA_KIND_TO_CAPABILITY_PROTOCOL,
  imageCapabilityFor,
} from '@superone/shared/provider-utils'
import { createProvider, deleteProvider, getAllProviders, updateProvider } from '../database'

export async function getMediaProviderStatuses(): Promise<MediaProviderStatus[]> {
  return getAllProviders().flatMap((provider): MediaProviderStatus[] => {
    const cap = imageCapabilityFor(provider)
    if (!cap) return []
    const models = cap.models ?? []
    return [{
      id: provider.id,
      label: provider.name,
      kind: IMAGE_PROTOCOL_TO_MEDIA_KIND[cap.protocol] ?? 'openai-compatible',
      categories: ['image'],
      defaultModel: models[0] ?? '',
      models: models.map((model) => ({ id: model, label: model })),
      apiKeyEnv: provider.api_key_env || undefined,
      baseURL: cap.baseUrl,
      custom: true,
      hasKey: !!provider.api_key,
      hasEnvKey: !!(provider.api_key_env && process.env[provider.api_key_env]),
    }]
  })
}

export async function setMediaProviderKey(providerId: string, apiKey: string): Promise<void> {
  updateProvider(providerId, { api_key: apiKey.trim() })
}

export async function upsertMediaCustomProvider(input: UpsertMediaProviderRequest): Promise<{ id: string }> {
  const kind = input.kind ?? 'openai-compatible'
  const models = input.models.map((m) => m.trim()).filter(Boolean)
  const capability: ProviderCapability = {
    id: `image-${kind}`,
    task: 'image',
    protocol: MEDIA_KIND_TO_CAPABILITY_PROTOCOL[kind] ?? 'openai-compatible-image',
    enabled: true,
    baseUrl: input.baseURL.trim() || undefined,
    models,
  }
  const capabilities = JSON.stringify([capability])
  const label = input.label.trim() || 'Image Provider'

  if (input.id) {
    updateProvider(input.id, { name: label, capabilities })
    return { id: input.id }
  }
  const created = createProvider({
    name: label,
    provider_type: 'custom',
    category: 'custom',
    supported_agents: '[]',
    capabilities,
  })
  return { id: created.id }
}

export async function removeMediaCustomProvider(id: string): Promise<void> {
  deleteProvider(id)
}
