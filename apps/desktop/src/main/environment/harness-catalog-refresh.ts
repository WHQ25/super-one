import type { HarnessId } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'

export { HARNESS_CATALOG_CHANGED, harnessAdvertisementKey } from '@superone/shared/environment'

function isHarnessId(id: string): id is HarnessId {
  return Object.hasOwn(HARNESS_CAPABILITIES, id)
}

/**
 * Connect records the set the descriptor already showed and does not notify.
 * A later `harness_catalog_changed` notifies when that set changed.
 */
export function harnessAdvertisementChanged(previous: string | undefined, next: string): boolean {
  return previous !== undefined && previous !== next
}

/** Known harness ids from a `harness_catalog_changed` payload, or null when the payload is malformed. */
export function harnessIdsFromCatalogEvent(payload: unknown): readonly HarnessId[] | null {
  if (!payload || typeof payload !== 'object') return null
  const ids = (payload as { harnessIds?: unknown }).harnessIds
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) return null
  return ids.filter(isHarnessId)
}
