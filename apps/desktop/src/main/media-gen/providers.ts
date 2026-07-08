import { IMAGE_PROTOCOL_TO_MEDIA_KIND, imageCapabilityFor } from '@superone/shared/provider-utils'
import { getAllProviders, getProviderByIdRaw } from '../database'
import type { MediaProviderConfig, MediaProviderKind } from './types'

export async function resolveMediaProvider(providerId: string): Promise<MediaProviderConfig> {
  const provider = getProviderByIdRaw(providerId)
  const cap = provider ? imageCapabilityFor(provider) : undefined
  if (!provider || !cap) throw new Error(`Unknown media-gen provider: ${providerId}`)

  const kind = IMAGE_PROTOCOL_TO_MEDIA_KIND[cap.protocol] as MediaProviderKind | undefined
  if (!kind) throw new Error(`media-gen provider '${providerId}' has no image capability`)

  const envKey = provider.api_key_env ? process.env[provider.api_key_env] : undefined
  const apiKey = provider.api_key || envKey || ''
  if (!apiKey) throw new Error(`No API key configured for media-gen provider '${providerId}'`)

  return { id: provider.id, kind, apiKey, baseURL: cap.baseUrl, models: cap.models }
}

export async function resolveDefaultModel(providerId: string): Promise<string> {
  const provider = getProviderByIdRaw(providerId)
  const first = provider ? imageCapabilityFor(provider)?.models?.[0] : undefined
  if (!first) throw new Error(`No default model available for media-gen provider '${providerId}'`)
  return first
}

/** Pick the first image provider that has a usable key (stored or env). */
export async function resolveDefaultProviderId(): Promise<string> {
  for (const provider of getAllProviders()) {
    if (!imageCapabilityFor(provider)) continue
    const hasEnv = !!(provider.api_key_env && process.env[provider.api_key_env])
    if (provider.api_key || hasEnv) return provider.id
  }
  throw new Error('No media-gen provider is configured. Ask the user to add one in Settings → Providers.')
}
