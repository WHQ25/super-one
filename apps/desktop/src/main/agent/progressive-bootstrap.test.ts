import { expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { ChatRuntime } from '../../../../mobile/src/runtime'
const { history } = vi.hoisted(() => ({ history: vi.fn() }))
vi.mock('../db-sessions', () => ({ loadSessionMessagesPaginated: history }))
vi.mock('../session/realtime-timeline-repo', () => ({ loadRealtimeTimeline: () => null }))
import { buildProgressiveBootstrap } from './progressive-bootstrap'

it('hydrates the current live state from one bounded bootstrap without hidden bodies', async () => {
  const source: ChatMessage = { id: 'm', role: 'assistant', status: 'streaming', createdAt: '', providerId: 'claude', content: [
    { type: 'thinking', thinking: 'hidden reasoning' },
    { type: 'tool_use', toolName: 'Write', toolUseId: 't', input: '{"file_path":"a.ts","content":"hidden code"}' },
  ] }
  history.mockReturnValue({ messages: [{ ...source, status: 'interrupted' }], hasMore: true, cursor: 100 })
  const host = { snapshot: { harnessId: 'claude', messages: [source] }, isStreaming: () => true,
    getPendingInteractions: () => [], getCurrentSandboxInfo: () => undefined, getCurrentPermissionMode: () => 'default' }
  const request = vi.fn(async () => buildProgressiveBootstrap(host as never, '/p', 's'))
  const runtime = new ChatRuntime({ request, startBuffering() {}, releaseBuffer: () => ({ epoch: 1, batches: [] }) } as never, vi.fn())
  await runtime.open('/p', 's')
  expect(request).toHaveBeenCalledTimes(1)
  expect(history).toHaveBeenCalledWith('s', 8)
  expect(runtime.messages[0]?.status).toBe('streaming')
  expect(runtime.hasMoreHistory).toBe(true)
  expect(JSON.stringify(runtime.messages)).not.toMatch(/hidden reasoning|hidden code/)
  expect(runtime.messages[0]?.content[1]).toMatchObject({ toolName: 'Write', toolLineDelta: { added: 1, removed: 0 } })
  expect(source.content[0]).toMatchObject({ thinking: 'hidden reasoning' })
  runtime.dispose()
})
