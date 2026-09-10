import { expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { extendHistoryIndex } from '@superone/shared/session-history-index'
import { ChatRuntime } from './runtime'
const rows: ChatMessage[] = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', status: 'complete', providerId: 'claude', createdAt: '', content: [{ type: 'text', text: `Message ${i}` }] }))
const index = extendHistoryIndex({ messageIds: [], entries: [], compacts: [] }, rows)
function setup() {
  const request = vi.fn(async (cmd: any): Promise<any> => {
    if (cmd.type === 'subscribe_session') return { historyPage: { messages: rows.slice(-8), cursor: 92, hasMore: true, navigationAvailable: true }, snapshot: {} }
    if (cmd.type === 'get_session_history_index') return index
    if (cmd.type === 'load_session_messages') return { messages: rows.slice(18,26) }
    return {}
  })
  const runtime = new ChatRuntime({ request, startBuffering() {}, releaseBuffer() { return { epoch: 1, batches: [] } } } as never, vi.fn())
  return { runtime, request }
}
it('restores eight rows, reads one index on demand, and merges a remote jump before live messages', async () => {
  const { runtime, request } = setup()
  await runtime.open('/p', 's')
  expect(runtime.messages).toHaveLength(8)
  expect(runtime.navigationAvailable).toBe(true)
  expect(request).toHaveBeenCalledTimes(1)
  const first = runtime.loadNavigationIndex()
  expect(runtime.loadNavigationIndex()).toBe(first)
  expect((await first).entries).toHaveLength(50)
  const page = await runtime.loadHistoryWindow('m20', 'around')
  expect(page.messages.map(m => m.id)).toEqual(rows.slice(18,26).map(m => m.id))
  expect(runtime.messages.map(m => m.id)).toEqual([...rows.slice(18,26), ...rows.slice(-8)].map(m => m.id))
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: 'load_session_messages', anchorId: 'm20', direction: 'around', limit: 8 }))
})
it('rejects a stale index after switching sessions', async () => {
  const { runtime, request } = setup()
  await runtime.open('/p', 's')
  let release!: (value: unknown) => void
  request.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const pending = runtime.loadNavigationIndex()
  const rejected = expect(pending).rejects.toThrow('Session changed')
  await runtime.open('/p', 'other')
  release(index)
  await rejected
})
it('a failed navigation request keeps the current messages and allows retry', async () => {
  const { runtime, request } = setup()
  await runtime.open('/p', 's')
  await runtime.loadNavigationIndex()
  request.mockRejectedValueOnce(new Error('Network unavailable'))
  await expect(runtime.loadHistoryWindow('m20', 'around')).rejects.toThrow('Network unavailable')
  expect(runtime.messages).toHaveLength(8)
  await runtime.loadHistoryWindow('m20', 'around')
  expect(runtime.messages).toHaveLength(16)
})
