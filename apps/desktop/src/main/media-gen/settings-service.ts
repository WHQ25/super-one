import type { MediaProviderStatus } from '@superone/shared/agent-types'
import { findPlatform } from '@superone/shared/platform-registry'
import { listCredentials } from '../providers/credential-store'
import { getPlatforms } from '../providers/registry'
import { resolveService } from '../providers/resolver'
import { imageModelsFor, mediaKindFor } from './providers'

/** Every credential that resolves to an image service, projected to the media-gen status shape. */
export async function getMediaProviderStatuses(): Promise<MediaProviderStatus[]> {
  const rows = await Promise.all(
    listCredentials().map(async (cred): Promise<MediaProviderStatus | null> => {
      const resolved = resolveService('media:image', { credentialId: cred.id })
      if (!resolved) return null
      const models = imageModelsFor(resolved)
      return {
        id: cred.id,
        label: cred.name,
        providerLabel: findPlatform(getPlatforms(), resolved.platformId)?.name || resolved.brand,
        kind: mediaKindFor(resolved),
        categories: ['image'],
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
