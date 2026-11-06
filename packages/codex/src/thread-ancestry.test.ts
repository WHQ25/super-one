import { afterEach, expect, it, vi } from 'vitest'
import { isCodexDescendantThread } from './thread-ancestry'
afterEach(() => vi.useRealTimers())
it('cancels a stalled read without relying on the paused RPC timeout', async () => {
  const abort = new AbortController()
  const pending = isCodexDescendantThread(async () => new Promise(() => {}), 'root', 'child', { signal: abort.signal })
  abort.abort()
  await expect(pending).rejects.toThrow(/cancel/)
})
it('bounds all reads by an independent deadline', async () => {
  vi.useFakeTimers()
  const pending = isCodexDescendantThread(async () => new Promise(() => {}), 'root', 'child', { timeoutMs: 100 })
  const assertion = expect(pending).rejects.toThrow(/timed out/)
  await vi.advanceTimersByTimeAsync(100)
  await assertion
})
it.each([{ forkedFromId: 'root' }, { source: { subAgent: { thread_spawn: { parent_thread_id: 'root' } } } }])('recognizes provider ancestry %j', async thread => {
  await expect(isCodexDescendantThread(async () => ({ thread }), 'root', 'child')).resolves.toBe(true)
})
