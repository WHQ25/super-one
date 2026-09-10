import { expect, it, vi } from 'vitest'
import { restoreSession } from './restore'
function client() {
  return { startBuffering: vi.fn(), releaseBuffer: vi.fn(() => ({ epoch: 1, batches: [] })),
    request: vi.fn(async ({ type }: { type: string }) => type === 'load_session_messages'
      ? { messages: [], hasMore: true, cursor: 500 } : { ok: true }) }
}
it('restores one bounded page even when thousands of older messages exist', async () => {
  const remote = client()
  const result = await restoreSession(remote as never, '/p', 's')
  expect(remote.request.mock.calls.map(([request]) => request.type)).toEqual(['subscribe_session', 'load_session_messages', 'get_session_state'])
  expect(remote.request).toHaveBeenCalledWith(expect.objectContaining({ type: 'load_session_messages', limit: 8 }))
  expect(result).toMatchObject({ hasMore: true, cursor: 500 })
})
it('releases the live buffer and reports a rejected subscription', async () => {
  const remote = client()
  remote.request.mockResolvedValue({ error: 'locked' } as never)
  await expect(restoreSession(remote as never, '/p', 's')).rejects.toThrow('locked')
  expect(remote.request).toHaveBeenCalledTimes(1)
  expect(remote.releaseBuffer).toHaveBeenCalledOnce()
})
it('uses a modern host bootstrap without additional round trips', async () => {
  const remote = client()
  remote.request.mockResolvedValue({ ok: true, historyPage: { messages: [], hasMore: true, cursor: 200 }, snapshot: { status: 'streaming' } } as never)
  const result = await restoreSession(remote as never, '/p', 's')
  expect(remote.request).toHaveBeenCalledTimes(1)
  expect(result).toMatchObject({ hasMore: true, cursor: 200, snapshot: { status: 'streaming' } })
})
