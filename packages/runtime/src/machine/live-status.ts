import { freemem } from 'node:os'
import type { EnvironmentLiveStatus } from '@superone/shared/environment'

/** Free memory now; the rest of a machine's facts are static (`machine-info.ts`). */
export function readLiveStatus(): EnvironmentLiveStatus {
  return { freeMemoryBytes: freemem() }
}
