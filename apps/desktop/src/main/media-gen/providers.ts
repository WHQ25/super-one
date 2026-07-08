import type { ResolvedService } from '@superone/shared/platform-registry'
import { listCredentials } from '../providers/credential-store'
import { resolveService } from '../providers/resolver'
import type { MediaProviderConfig, MediaProviderKind } from './types'

/**
 * Adapter selection for image protocols. The strict-vs-compatible OpenAI split is decided by
 * platform id (official `openai` → strict `createOpenAI`), not by protocol (plan §2.1).
 */
export function mediaKindFor(resolved: ResolvedService): MediaProviderKind {
  switch (resolved.protocol) {
    case 'google-generative':
      return 'google'
    case 'openai-images':
    case 'openai-responses':
      return resolved.platformId === 'openai' || resolved.platformId === 'openai-official'
        ? 'openai'
        : 'openai-compatible'
    default:
      throw new Error(`protocol '${resolved.protocol}' does not serve image generation`)
  }
}

function toConfig(resolved: ResolvedService): MediaProviderConfig {
  return {
    id: resolved.credentialId,
    kind: mediaKindFor(resolved),
    apiKey: resolved.apiKey,
    baseURL: resolved.baseUrl || undefined,
    models: resolved.models.map((m) => m.id),
  }
}

/** Resolve an image provider from a credential id (or the global `media:image` binding when omitted). */
export async function resolveMediaProvider(credentialId?: string | null): Promise<MediaProviderConfig> {
  const resolved = resolveService('media:image', { credentialId })
  if (!resolved) throw new Error('No image provider is configured. Ask the user to add one in Settings → Providers.')
  if (!resolved.apiKey) throw new Error(`No API key configured for image provider '${resolved.credentialId}'`)
  return toConfig(resolved)
}

export async function resolveDefaultModel(credentialId?: string | null): Promise<string> {
  const resolved = resolveService('media:image', { credentialId })
  const first = resolved?.models[0]?.id
  if (!first) throw new Error('No default model available for the image provider')
  return first
}

/** Pick an image credential that resolves with a usable key — the bound one first, else any. */
export async function resolveDefaultProviderId(): Promise<string> {
  const bound = resolveService('media:image')
  if (bound?.apiKey) return bound.credentialId
  for (const cred of listCredentials()) {
    const resolved = resolveService('media:image', { credentialId: cred.id })
    if (resolved?.apiKey) return resolved.credentialId
  }
  throw new Error('No image provider is configured. Ask the user to add one in Settings → Providers.')
}
