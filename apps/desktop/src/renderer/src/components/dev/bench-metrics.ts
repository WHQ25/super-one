import type { AppMetricsSnapshot } from '@superone/shared/agent-types'

export interface MetricSample {
  rendererCpu: number
  rendererWakeups: number
  rendererMemMB: number
  gpuCpu: number
  gpuWakeups: number
  gpuMemMB: number
}

const EMPTY: MetricSample = {
  rendererCpu: 0,
  rendererWakeups: 0,
  rendererMemMB: 0,
  gpuCpu: 0,
  gpuWakeups: 0,
  gpuMemMB: 0,
}

export function reduceSnapshot(snap: AppMetricsSnapshot): MetricSample {
  const self = snap.metrics.find((m) => m.pid === snap.selfPid)
  const gpus = snap.metrics.filter((m) => m.type === 'GPU')
  const cpuScale = snap.logicalCpuCount || 1
  const sumCpu = gpus.reduce((a, m) => a + m.cpu.percentCPUUsage * cpuScale, 0)
  const sumWake = gpus.reduce((a, m) => a + m.cpu.idleWakeupsPerSecond, 0)
  const sumMem = gpus.reduce((a, m) => a + m.memory.workingSetSize, 0)
  return {
    rendererCpu: (self?.cpu.percentCPUUsage ?? 0) * cpuScale,
    rendererWakeups: self?.cpu.idleWakeupsPerSecond ?? 0,
    rendererMemMB: (self?.memory.workingSetSize ?? 0) / 1024,
    gpuCpu: sumCpu,
    gpuWakeups: sumWake,
    gpuMemMB: sumMem / 1024,
  }
}

export function averageSamples(samples: MetricSample[]): MetricSample {
  if (samples.length === 0) return { ...EMPTY }
  const acc = samples.reduce(
    (a, s) => ({
      rendererCpu: a.rendererCpu + s.rendererCpu,
      rendererWakeups: a.rendererWakeups + s.rendererWakeups,
      rendererMemMB: a.rendererMemMB + s.rendererMemMB,
      gpuCpu: a.gpuCpu + s.gpuCpu,
      gpuWakeups: a.gpuWakeups + s.gpuWakeups,
      gpuMemMB: a.gpuMemMB + s.gpuMemMB,
    }),
    { ...EMPTY },
  )
  const n = samples.length
  return {
    rendererCpu: acc.rendererCpu / n,
    rendererWakeups: acc.rendererWakeups / n,
    rendererMemMB: acc.rendererMemMB / n,
    gpuCpu: acc.gpuCpu / n,
    gpuWakeups: acc.gpuWakeups / n,
    gpuMemMB: acc.gpuMemMB / n,
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
