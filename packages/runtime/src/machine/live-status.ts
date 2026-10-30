import { cpus, freemem, type CpuInfo } from 'node:os'
import type { EnvironmentLiveStatus } from '@superone/shared/environment'

/** Free memory now; the rest of a machine's facts are static (`machine-info.ts`). */
export function readLiveStatus(): EnvironmentLiveStatus {
  return { freeMemoryBytes: freemem() }
}

/** Long enough for a stable percent, short enough that a hover card does not wait. */
export const CPU_SAMPLE_MS = 200

export interface CpuSnapshot {
  idle: number
  total: number
}

type CpuReader = () => ReadonlyArray<Pick<CpuInfo, 'times'>>

/** Busy share between two `os.cpus()` snapshots, as a whole percent. */
export function cpuPercentBetween(first: CpuSnapshot, second: CpuSnapshot): number | null {
  const total = second.total - first.total
  const idle = second.idle - first.idle
  if (total <= 0) return null
  const busy = (1 - idle / total) * 100
  if (!Number.isFinite(busy)) return null
  return Math.min(100, Math.max(0, Math.round(busy)))
}

export function readCpuSnapshot(read: CpuReader = cpus): CpuSnapshot {
  let idle = 0
  let total = 0
  for (const cpu of read()) {
    idle += cpu.times.idle
    for (const value of Object.values(cpu.times)) total += value
  }
  return { idle, total }
}

/**
 * One CPU sample. Callers use this when a card opens, then stop.
 * There is no background sampler.
 */
export function sampleCpuPercent(intervalMs = CPU_SAMPLE_MS, read: CpuReader = cpus): Promise<number | null> {
  const first = readCpuSnapshot(read)
  return new Promise((resolve) => {
    setTimeout(() => resolve(cpuPercentBetween(first, readCpuSnapshot(read))), intervalMs)
  })
}
