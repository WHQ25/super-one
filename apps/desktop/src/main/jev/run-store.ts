import type { BrowserRun } from './loop'

/**
 * Paused runs, keyed by runId and owned by the session that started them. A
 * paused run holds no browser resources (the focus guard is released on
 * pause), so the only thing a stale entry costs is memory — hence the TTL.
 */
const TTL_MS = 5 * 60_000

interface Entry {
  run: BrowserRun
  sessionId: string
  pausedAt: number
}

const runs = new Map<string, Entry>()

function sweep(now: number): void {
  for (const [id, entry] of runs) {
    if (now - entry.pausedAt > TTL_MS) runs.delete(id)
  }
}

export function storePausedRun(sessionId: string, run: BrowserRun, now = Date.now()): void {
  sweep(now)
  runs.set(run.runId, { run, sessionId, pausedAt: now })
}

export function takePausedRun(sessionId: string, runId: string, now = Date.now()): BrowserRun | 'expired' | 'foreign' | 'missing' {
  const entry = runs.get(runId)
  if (!entry) return 'missing'
  if (entry.sessionId !== sessionId) return 'foreign'
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
