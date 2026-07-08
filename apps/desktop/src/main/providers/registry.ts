import { assembleRegistry, BUILTIN_PLATFORMS, type Platform } from '@superone/shared/platform-registry'
import { listCustomPlatforms } from './credential-store'

/** builtin ∪ custom (from custom_platforms). Custom ids override builtin. */
export function getPlatforms(): Platform[] {
  return assembleRegistry(BUILTIN_PLATFORMS, listCustomPlatforms())
}
