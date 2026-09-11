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

function msg(id: string) {
  return { id, role: 'assistant' as const, status: 'complete' as const, content: [{ type: 'text' as const, text: id }], createdAt: '', providerId: 'claude' }
}

it('keeps older cached rows and replaces the overlapping tail', async () => {
  const { mergeCachedHistory, appendHistory } = await import('./restore')
  expect(mergeCachedHistory([msg('a'), msg('b'), msg('c')], [msg('b'), msg('c'), msg('d')]).messages.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd'])
  expect(appendHistory([msg('a'), msg('b')], [msg('c')]).map((row) => row.id)).toEqual(['a', 'b', 'c'])
})

it('reuses a cached transcript and only fetches messages after the last row', async () => {
  const remote = client()
  const cached = { messages: [msg('a'), msg('b')], hasMore: true, cursor: 10 }
  remote.request.mockImplementation((async (request: { type: string; direction?: string }) => {
    if (request.type === 'subscribe_session') return { ok: true, snapshot: { status: 'idle' } }
    if (request.type === 'load_session_messages' && request.direction === 'after') return { messages: [msg('c')], hasMore: false }
    return { ok: true }
  }) as never)
  const result = await restoreSession(remote as never, '/p', 's', cached)
  expect(remote.request.mock.calls.map(([request]) => [request.type, (request as { direction?: string }).direction])).toEqual([
    ['subscribe_session', undefined],
    ['load_session_messages', 'after'],
  ])
  expect(result.messages.map((row) => row.id)).toEqual(['a', 'b', 'c'])
  expect(result.hasMore).toBe(true)
  expect(result.cursor).toBe(10)
})

it('skips history reload when the progressive page overlaps the cache', async () => {
  const remote = client()
  remote.request.mockResolvedValue({
    ok: true,
    historyPage: { messages: [msg('b'), msg('c')], hasMore: false, cursor: null },
    snapshot: { status: 'idle' },
  } as never)
  const result = await restoreSession(remote as never, '/p', 's', {
    messages: [msg('a'), msg('b')], hasMore: true, cursor: 4,
  })
  expect(remote.request).toHaveBeenCalledTimes(1)
  expect(result.messages.map((row) => row.id)).toEqual(['a', 'b', 'c'])
})

it('uses the host page cursor when the cache does not overlap', async () => {
  const remote = client()
  remote.request.mockImplementation((async (request: { type: string; direction?: string }) => {
    if (request.type === 'subscribe_session') {
      return { ok: true, historyPage: { messages: [msg('m100'), msg('m101')], hasMore: true, cursor: 100 }, snapshot: { status: 'idle' } }
    }
    if (request.type === 'load_session_messages' && request.direction === 'after') return { error: 'History message no longer exists' }
    return { ok: true }
  }) as never)
  const result = await restoreSession(remote as never, '/p', 's', {
    messages: [msg('m10'), msg('m11')], hasMore: true, cursor: 10,
  })
  expect(result.messages.map((row) => row.id)).toEqual(['m100', 'm101'])
  expect(result.cursor).toBe(100)
  expect(result.hasMore).toBe(true)
})

it('drops cached rows when the host history page is authoritatively empty', async () => {
  const remote = client()
  remote.request.mockResolvedValue({
    ok: true,
    historyPage: { messages: [], hasMore: false, cursor: null },
    snapshot: { status: 'idle' },
  } as never)
  const result = await restoreSession(remote as never, '/p', 's', {
    messages: [msg('old')], hasMore: true, cursor: 4,
  })
  expect(result.messages).toEqual([])
  expect(result.hasMore).toBe(false)
  expect(result.cursor).toBeNull()
})

it('rejects a bootstrap historyPage error instead of reusing the cache', async () => {
  const remote = client()
  remote.request.mockResolvedValue({ ok: true, historyPage: { error: 'locked' }, snapshot: {} } as never)
  await expect(restoreSession(remote as never, '/p', 's', { messages: [msg('a')], hasMore: false, cursor: null }))
    .rejects.toThrow('locked')
})

it('pages after the last complete cached row until the newest page overlaps', async () => {
  const remote = client()
  const afterPages: Record<string, string[]> = {
    a: Array.from({ length: 40 }, (_, i) => `n${i}`),
    n39: ['n40', 'z'],
  }
  remote.request.mockImplementation((async (request: { type: string; direction?: string; anchorId?: string }) => {
    if (request.type === 'subscribe_session') {
      return { ok: true, historyPage: { messages: [msg('z')], hasMore: false, cursor: null }, snapshot: { status: 'idle' } }
    }
    if (request.type === 'load_session_messages' && request.direction === 'after') {
      return { messages: (afterPages[request.anchorId ?? ''] ?? []).map(msg) }
    }
    return { ok: true }
  }) as never)
  const result = await restoreSession(remote as never, '/p', 's', {
    messages: [
      msg('a'),
      { ...msg('live'), status: 'streaming' },
    ], hasMore: false, cursor: null,
  })
  expect(remote.request.mock.calls.filter(([request]) => request.type === 'load_session_messages')).toHaveLength(2)
  expect(result.messages.map((row) => row.id)).toEqual(['a', ...afterPages.a, 'n40', 'z'])
  expect(result.messages.some((row) => row.status === 'streaming')).toBe(false)
})
