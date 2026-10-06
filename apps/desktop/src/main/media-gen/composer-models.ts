import type { MediaComposerKind, MediaComposerModel } from '@superone/shared/media-composer'
import { listCredentials } from '../providers/credential-store'
import { listServiceModels, resolveService } from '../providers/resolver'
import { modelCapabilities } from './capabilities'

export function mediaComposerModels(kind: MediaComposerKind): MediaComposerModel[] {
  if (kind !== 'image' && kind !== 'video') throw new Error('Invalid media kind')
  const consumer = kind === 'image' ? 'media:image' : 'media:video'
  const bound = resolveService(consumer)
  return listCredentials().flatMap(credential => listServiceModels(consumer, credential.id).flatMap(model => {
    const resolved = resolveService(consumer, { credentialId: credential.id, modelId: model.id })
    if (!resolved?.apiKey || resolved.credentialId !== credential.id) return []
    return [{ providerId: credential.id, providerLabel: credential.name, model: model.id,
      label: model.name ?? model.id, default: bound?.credentialId === credential.id && bound.models[0]?.id === model.id,
      ...modelCapabilities(kind, resolved, model.id) }]
  }))
}
