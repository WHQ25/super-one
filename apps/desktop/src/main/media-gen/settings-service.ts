import type { MediaProviderStatus } from '@superone/shared/agent-types'
import { listCredentials } from '../providers/credential-store'
import { resolveService } from '../providers/resolver'
import { mediaKindFor } from './providers'

/** Every credential that resolves to an image service, projected to the media-gen status shape. */
export async function getMediaProviderStatuses(): Promise<MediaProviderStatus[]> {
  return listCredentials().flatMap((cred): MediaProviderStatus[] => {
    const resolved = resolveService('media:image', { credentialId: cred.id })
    if (!resolved) return []
    return [
      {
        id: cred.id,
        label: cred.name,
        kind: mediaKindFor(resolved),
        categories: ['image'],
        defaultModel: resolved.models[0]?.id ?? '',
        models: resolved.models.map((m) => ({ id: m.id, label: m.name ?? m.id })),
        apiKeyEnv: cred.secretEnv || undefined,
        baseURL: resolved.baseUrl || undefined,
        custom: true,
        hasKey: !!resolved.apiKey,
        hasEnvKey: !!(cred.secretEnv && process.env[cred.secretEnv]),
      },
    ]
  })
}
