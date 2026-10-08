import { cpus, freemem, loadavg, platform } from 'node:os'
import type { EnvironmentGuiState, EnvironmentLiveStatus } from '@superone/shared/environment'

/** What a session contributes to the counts in {@link EnvironmentLiveStatus}. */
export interface SessionActivity {
  running: boolean
  pending: boolean
}

/** Live host load plus session counts; `sessions` is null when the host serves none. */
export function readLiveStatus(input: {
  sessions: Iterable<SessionActivity> | null
  gui: EnvironmentGuiState
}): EnvironmentLiveStatus {
  let counts: EnvironmentLiveStatus['sessions']
  if (input.sessions) {
    counts = { running: 0, pending: 0 }
    for (const session of input.sessions) {
      if (session.running) counts.running++
      if (session.pending) counts.pending++
    }
  }
  return {
    // Windows has no load average; Node reports zeros there.
    ...(platform() === 'win32' ? {} : { load1: Math.round(loadavg()[0] * 100) / 100 }),
    cpuCores: cpus().length,
    freeMemoryBytes: freemem(),
    ...(counts ? { sessions: counts } : {}),
    gui: input.gui,
  }
}
