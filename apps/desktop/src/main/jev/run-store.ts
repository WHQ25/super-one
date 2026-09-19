import type { JevRunAction } from '@superone/shared/agent-types'
import type { Answer, RunResult } from './loop'

/** Only the suspended coroutine crosses the tool/store boundary. */
export interface PausedRun {
  readonly runId: string
  resume(answer: Answer, signal?: AbortSignal): Promise<RunResult>
  setReporter(report: (action: JevRunAction) => void): void
}

/**
 * Paused runs, keyed by runId and owned by the session that started them. A
 * paused run holds no browser resources (the focus guard is released on
 * pause), so the only thing a stale entry costs is memory — hence the TTL.
 */
const TTL_MS = 5 * 60_000

export type RunPlatform = 'browser' | 'computer' | 'device'

interface Entry {
  platform: RunPlatform
  run: PausedRun
  sessionId: string
  pausedAt: number
}

const runs = new Map<string, Entry>()

function sweep(now: number): void {
  for (const [id, entry] of runs) {
    if (now - entry.pausedAt > TTL_MS) runs.delete(id)
  }
}

export function storePausedRun(sessionId: string, run: PausedRun, now = Date.now(), platform: RunPlatform = 'browser'): void {
  sweep(now)
  runs.set(run.runId, { run, sessionId, pausedAt: now, platform })
}

export function takePausedRun(sessionId: string, runId: string, now = Date.now(), platform: RunPlatform = 'browser'): PausedRun | 'expired' | 'foreign' | 'missing' | 'wrong-platform' {
  const entry = runs.get(runId)
  if (!entry) return 'missing'
  if (entry.sessionId !== sessionId) return 'foreign'
  if (entry.platform !== platform) return 'wrong-platform'
  runs.delete(runId)
  if (now - entry.pausedAt > TTL_MS) return 'expired'
  return entry.run
}

export function clearPausedRuns(sessionId?: string): void {
  if (!sessionId) {
    runs.clear()
    return
  }
  for (const [id, entry] of runs) if (entry.sessionId === sessionId) runs.delete(id)
}
