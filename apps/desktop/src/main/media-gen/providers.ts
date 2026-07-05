import { getCustomProvider, readCustomProviders } from './custom-providers'
import { readMediaKeys } from './keys'
import { getMediaProviderPreset, MEDIA_PROVIDER_PRESETS } from './presets'
import type { MediaProviderConfig } from './types'

export async function resolveMediaProvider(providerId: string): Promise<MediaProviderConfig> {
  const storedKeys = await readMediaKeys().catch(() => ({}) as Record<string, string>)

  const preset = getMediaProviderPreset(providerId)
  if (preset) {
    const envKey = preset.apiKeyEnv ? process.env[preset.apiKeyEnv] : undefined
    const apiKey = storedKeys[providerId] || envKey || ''
    if (!apiKey) throw new Error(`No API key configured for media-gen provider '${providerId}'`)
    return {
      id: preset.id,
      kind: preset.kind,
      apiKey,
      baseURL: preset.defaultBaseURL,
      models: preset.models.map((model) => model.id),
    }
  }

  const custom = await getCustomProvider(providerId)
  if (custom) {
    const apiKey = storedKeys[providerId] || ''
    if (!apiKey) throw new Error(`No API key configured for media-gen provider '${providerId}'`)
    return { id: custom.id, kind: custom.kind, apiKey, baseURL: custom.baseURL, models: custom.models }
  }

  throw new Error(`Unknown media-gen provider: ${providerId}`)
}

export async function resolveDefaultModel(providerId: string): Promise<string> {
  const preset = getMediaProviderPreset(providerId)
  if (preset) return preset.defaultModel
  const custom = await getCustomProvider(providerId)
  if (custom && custom.models.length > 0) return custom.models[0]
  throw new Error(`No default model available for media-gen provider '${providerId}'`)
}

/** Pick the first provider that has a usable key (stored or env), preferring built-ins. */
export async function resolveDefaultProviderId(): Promise<string> {
  const keys = await readMediaKeys().catch(() => ({}) as Record<string, string>)
  for (const preset of MEDIA_PROVIDER_PRESETS) {
    const envKey = preset.apiKeyEnv ? process.env[preset.apiKeyEnv] : undefined
    if (keys[preset.id] || envKey) return preset.id
  }
  const custom = (await readCustomProviders()).find((provider) => keys[provider.id])
  if (custom) return custom.id
  throw new Error('No media-gen provider is configured. Ask the user to add one in Settings → Image Gen.')
}
