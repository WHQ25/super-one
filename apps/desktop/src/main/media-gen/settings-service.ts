import type { MediaProviderStatus, UpsertMediaProviderRequest } from '@superone/shared/agent-types'
import {
  readCustomProviders,
  removeCustomProvider,
  upsertCustomProvider,
} from './custom-providers'
import { readMediaKeys, setMediaKey } from './keys'
import { MEDIA_PROVIDER_PRESETS } from './presets'

export async function getMediaProviderStatuses(): Promise<MediaProviderStatus[]> {
  const keys = await readMediaKeys().catch(() => ({}) as Record<string, string>)
  const customs = await readCustomProviders()

  const presetStatuses: MediaProviderStatus[] = MEDIA_PROVIDER_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    kind: preset.kind,
    categories: preset.categories,
    defaultModel: preset.defaultModel,
    models: preset.models,
    apiKeyEnv: preset.apiKeyEnv,
    custom: false,
    hasKey: !!keys[preset.id],
    hasEnvKey: !!(preset.apiKeyEnv && process.env[preset.apiKeyEnv]),
  }))

  const customStatuses: MediaProviderStatus[] = customs.map((provider) => ({
    id: provider.id,
    label: provider.label,
    kind: provider.kind,
    categories: ['image'],
    defaultModel: provider.models[0] ?? '',
    models: provider.models.map((model) => ({ id: model, label: model })),
    baseURL: provider.baseURL,
    custom: true,
    hasKey: !!keys[provider.id],
    hasEnvKey: false,
  }))

  return [...presetStatuses, ...customStatuses]
}

export async function setMediaProviderKey(providerId: string, apiKey: string): Promise<void> {
  await setMediaKey(providerId, apiKey.trim())
}

export async function upsertMediaCustomProvider(input: UpsertMediaProviderRequest): Promise<{ id: string }> {
  const entry = await upsertCustomProvider(input)
  return { id: entry.id }
}

export async function removeMediaCustomProvider(id: string): Promise<void> {
  await removeCustomProvider(id)
  await setMediaKey(id, '')
}
