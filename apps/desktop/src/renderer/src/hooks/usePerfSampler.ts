import { useEffect } from 'react'
import { perfSample } from '@/lib/perf-trace'

const SAMPLE_INTERVAL_MS = 2000

export function usePerfSampler(): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return
    perfSample()
    const id = window.setInterval(perfSample, SAMPLE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [])
}
