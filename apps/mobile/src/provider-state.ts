import type { HarnessId } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness-capabilities'

export const MOBILE_HARNESS_IDS = Object.freeze(
  Object.keys(HARNESS_CAPABILITIES) as HarnessId[],
)

export function harnessSupportsAdditionalDirs(harness: HarnessId): boolean {
  return HARNESS_CAPABILITIES[harness].supportsAdditionalDirs
}

export function harnessDisplayName(harness: HarnessId): string {
  return HARNESS_CAPABILITIES[harness].displayName
}
