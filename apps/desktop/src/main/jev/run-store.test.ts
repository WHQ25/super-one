import { afterEach, expect, it, vi } from 'vitest'
import { clearPausedRuns, storePausedRun, takePausedRun } from './run-store'
afterEach(() => clearPausedRuns())
it('binds paused runs to both session and platform without consuming on a mismatch', () => {
  const run = { runId: 'rtest', resume: vi.fn() }
  storePausedRun('owner', run, 0, 'computer')
  expect(takePausedRun('other', run.runId, 1, 'computer')).toBe('foreign')
  expect(takePausedRun('owner', run.runId, 1, 'browser')).toBe('wrong-platform')
  expect(takePausedRun('owner', run.runId, 1, 'computer')).toBe(run)
  expect(takePausedRun('owner', run.runId, 1, 'computer')).toBe('missing')
})
it('expires paused runs after five minutes', () => {
  const run = { runId: 'rtest', resume: vi.fn() }
  storePausedRun('owner', run, 0, 'computer')
  expect(takePausedRun('owner', run.runId, 300001, 'computer')).toBe('expired')
})
