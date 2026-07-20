import type { MediaProviderStatus } from '@superone/shared/agent-types'
import { findPlatform } from '@superone/shared/platform-registry'
import { listCredentials } from '../providers/credential-store'
import { getPlatforms } from '../providers/registry'
import { resolveService } from '../providers/resolver'
import { imageModelsFor, mediaKindFor, videoKindFor, videoModelsFor } from './providers'

/**
 * Every credential that resolves to an image or video service, projected to the media-gen status shape.
 *
 * A credential can serve both — one Volcengine key reaches Seedream and Seedance through different
 * endpoints — so each capability resolves independently and the results merge into one row.
 * `categories` is what `media_list_providers` filters on, so it has to reflect what actually resolved
 * rather than being hardcoded.
 */
export async function getMediaProviderStatuses(): Promise<MediaProviderStatus[]> {
  const rows = await Promise.all(
    listCredentials().map(async (cred): Promise<MediaProviderStatus | null> => {
      const image = resolveService('media:image', { credentialId: cred.id })
      const video = resolveService('media:video', { credentialId: cred.id })
      const resolved = image ?? video
      if (!resolved) return null

      const models = [...(image ? imageModelsFor(image) : []), ...(video ? videoModelsFor(video) : [])]

      return {
        id: cred.id,
        label: cred.name,
        providerLabel: findPlatform(getPlatforms(), resolved.platformId)?.name || resolved.brand,
        kind: image ? mediaKindFor(image) : videoKindFor(resolved),
        categories: [...(image ? ['image'] : []), ...(video ? ['video'] : [])],
        defaultModel: models[0]?.id ?? '',
        models: models.map((m) => ({ id: m.id, label: m.name ?? m.id })),
        apiKeyEnv: cred.secretEnv || undefined,
        baseURL: resolved.baseUrl || undefined,
        custom: true,
        hasKey: !!resolved.apiKey,
        hasEnvKey: !!(cred.secretEnv && process.env[cred.secretEnv]),
      }
    }),
  )
  return rows.filter((r): r is MediaProviderStatus => r !== null)
}
