import { expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { extendHistoryIndex } from '@superone/shared/session-history-index'
import { ChatRuntime } from './runtime'
import { resolveTestProject } from './project-rpc.test-fixtures'
const rows: ChatMessage[] = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', status: 'complete', providerId: 'claude', createdAt: '', content: [{ type: 'text', text: `Message ${i}` }] }))
const index = extendHistoryIndex({ messageIds: [], entries: [], compacts: [] }, rows)
function setup() {
  const rpc = vi.fn(async (method: string, payload: any): Promise<any> => {
    if (method === 'session.load') return { sessionId: payload.sessionId, projectId: 'p',
      messages: payload.anchorId ? rows.slice(18, 26) : rows.slice(-8), before: payload.anchorId ? 18 : 92,
      state: { sessionProvider: 'claude', status: 'idle' }, cursor: { sequence: '100', version: 100, epoch: 'test' } }
    if (method === 'session.historyIndex') return index
    if (method === 'environment.descriptor') return { capabilities: { methods: ['session.historyIndex'] } }
    throw new Error(`Unexpected native RPC ${method}`)
  })
  const runtime = new ChatRuntime({ rpc, environmentId: 'desktop', resolveProject: resolveTestProject,
    startBuffering() {}, releaseBuffer: () => ({ epoch: 1, batches: [] }), stopSession: async () => {},
    followSession: async () => {}, acquireControl: async () => ({ leaseId: 'l', generation: '1' }),
  } as never, vi.fn())
  return { runtime, rpc }
}
it('restores eight rows, reads one index on demand, and merges a remote jump before live messages', async () => {
  const { runtime, rpc } = setup()
  await runtime.open('/p', 's')
  expect(runtime.messages).toHaveLength(8)
  expect(runtime.navigationAvailable).toBe(true)
  expect(rpc).toHaveBeenCalledTimes(2)
  const first = runtime.loadNavigationIndex()
  expect(runtime.loadNavigationIndex()).toBe(first)
  expect((await first).entries).toHaveLength(50)
  const page = await runtime.loadHistoryWindow('m20', 'around')
  expect(page.messages.map(m => m.id)).toEqual(rows.slice(18,26).map(m => m.id))
  expect(runtime.messages.map(m => m.id)).toEqual([...rows.slice(18,26), ...rows.slice(-8)].map(m => m.id))
  expect(rpc).toHaveBeenCalledWith('session.load', expect.objectContaining({ sessionId: 's', anchorId: 'm20', direction: 'around', limit: 8, includeState: false }), { environmentId: 'desktop' })
})
it('rejects a stale index after switching sessions', async () => {
  const { runtime, rpc } = setup()
  await runtime.open('/p', 's')
  let release!: (value: unknown) => void
  rpc.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const pending = runtime.loadNavigationIndex()
  const rejected = expect(pending).rejects.toThrow('Session changed')
  await runtime.open('/p', 'other')
  release(index)
  await rejected
})
it('a failed navigation request keeps the current messages and allows retry', async () => {
  const { runtime, rpc } = setup()
  await runtime.open('/p', 's')
  await runtime.loadNavigationIndex()
  rpc.mockRejectedValueOnce(new Error('Network unavailable'))
  await expect(runtime.loadHistoryWindow('m20', 'around')).rejects.toThrow('Network unavailable')
  expect(runtime.messages).toHaveLength(8)
  await runtime.loadHistoryWindow('m20', 'around')
  expect(runtime.messages).toHaveLength(16)
})
