import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { TranscriptWindowRequest, TranscriptWindowResult } from '@superone/shared/environment/transcript-window'
import { selectTranscriptWindow, DEFAULT_WINDOW_BUDGET } from '@superone/shared/transcript-window/select-window'
import { materializeWindowMessage } from '@superone/shared/transcript-window/window-store'
import { conversation, windowSource } from '@superone/shared/transcript-window/window-fixtures'
import { RestoreRejectedError } from './restore'
import { restoreWindowSession, TranscriptWindowUnsupportedError, type CachedWindow } from './restore-window'

const cursor = { sequence: '90', epoch: 'epoch', version: 12 }

function host(messages: ChatMessage[]) {
  const order: string[] = []
  const requests: TranscriptWindowRequest[] = []
  const rpc = vi.fn(async (method: string, payload?: unknown): Promise<unknown> => {
    order.push(method)
    if (method === 'environment.descriptor') return { capabilities: { methods: ['session.historyIndex', 'session.transcriptWindow'] } }
    const request = payload as TranscriptWindowRequest
    requests.push(request)
    const selected = selectTranscriptWindow(windowSource(messages), request, { ...DEFAULT_WINDOW_BUDGET, targetChars: 1e6 })
    return { sessionId: 's', schema: 1, ...selected, total: messages.length, state: { status: 'streaming', sessionProvider: 'claude' }, cursor } satisfies TranscriptWindowResult
  })
  return {
    order, requests, rpc,
    startBuffering: vi.fn(() => order.push('buffer')), stopSession: vi.fn(async () => { order.push('stop') }),
    resolveProject: vi.fn(async () => ({ environmentId: 'desk', projectId: 'p' })),
    releaseBuffer: vi.fn(() => ({ epoch: 3, batches: [[
      { type: 'status_change', environmentId: 'desk', sessionId: 's', seq: 12 },
      { type: 'transcript_window', environmentId: 'desk', sessionId: 's', seq: 13, patch: { messages: [], total: 6 } },
    ]] as unknown[][] })),
    acquireControl: vi.fn(async () => { order.push('acquire') }), followSession: vi.fn(async () => { order.push('subscribe') }),
  }
}

describe('restoreWindowSession', () => {
  it('reads the window at one cursor before acquiring control and following it', async () => {
    const remote = host(conversation(6))
    const restored = await restoreWindowSession(remote as never, '/p', 's', null, { viewport: { width: 390, height: 844 } })
    expect(remote.order).toEqual(['buffer', 'stop', 'session.transcriptWindow', 'environment.descriptor', 'acquire', 'subscribe'])
    expect(remote.requests[0]).toMatchObject({ sessionId: 's', projectId: 'p', viewport: { width: 390, height: 844 } })
    expect(remote.followSession).toHaveBeenCalledWith({ session: { environmentId: 'desk', sessionId: 's' }, projectPath: '/p', provider: 'claude', cursor })
    expect(restored.window.messages.map((m) => m.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5'])
    expect(restored).toMatchObject({ epoch: 3, navigationAvailable: true, state: { status: 'streaming' }, metrics: { reusedFragments: 0, sentFragments: 6 } })
    expect(restored.liveBatches.flat()).toEqual([expect.objectContaining({ type: 'transcript_window', seq: 13 })])
  })

  it('claims cached fragments so only new content is sent', async () => {
    const before = conversation(6)
    const first = await restoreWindowSession(host(before) as never, '/p', 's', null)
    const cached: CachedWindow = { schema: 1, window: first.window }
    const remote = host([...before, ...conversation(2, 'n')])
    const restored = await restoreWindowSession(remote as never, '/p', 's', cached)
    expect(remote.requests[0].have?.map((entry) => entry.id)).toEqual(['m5', 'm4', 'm3', 'm2', 'm1', 'm0'])
    expect(restored.metrics).toMatchObject({ reusedFragments: 6, sentFragments: 2 })
    expect(restored.window.messages.map(materializeWindowMessage).map((m) => m.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'n0', 'n1'])
  })

  it('reads again without claims when a cached body is missing', async () => {
    const messages = conversation(2)
    const first = await restoreWindowSession(host(messages) as never, '/p', 's', null)
    const damaged: CachedWindow = { schema: 1, window: { ...first.window, messages: [] } }
    const remote = host(messages)
    // Coverage claims bodies the damaged cache no longer holds.
    remote.rpc.mockImplementationOnce(async (method: string, payload?: unknown) => {
      remote.order.push(method)
      const request = { ...(payload as TranscriptWindowRequest), have: [{ id: 'm0', f: [['text::0~0', 'x']] as Array<[string, string]> }] }
      const selected = selectTranscriptWindow(windowSource(messages), { have: request.have }, DEFAULT_WINDOW_BUDGET)
      return { sessionId: 's', schema: 1, ...selected, total: 2, cursor, messages: selected.messages.map((m) => ({ ...m, fragments: m.fragments.map(({ body: _b, ...ref }) => ref) })) }
    })
    const restored = await restoreWindowSession(remote as never, '/p', 's', damaged)
    expect(remote.order.filter((method) => method === 'session.transcriptWindow')).toHaveLength(2)
    expect(remote.requests.at(-1)?.have).toBeUndefined()
    expect(restored.window.messages).toHaveLength(2)
  })

  it('reports a host without windows so the caller restores the legacy way', async () => {
    const remote = host([])
    remote.rpc.mockImplementation(async (method: string) => {
      if (method === 'environment.descriptor') return { capabilities: { methods: [] } }
      throw Object.assign(new Error('unsupported method'), { code: 'unsupported' })
    })
    await expect(restoreWindowSession(remote as never, '/p', 's', null)).rejects.toBeInstanceOf(TranscriptWindowUnsupportedError)
    expect(remote.releaseBuffer).toHaveBeenCalled()
    expect(remote.stopSession).toHaveBeenCalledTimes(2)
  })

  it('maps host refusals', async () => {
    const remote = host([])
    remote.rpc.mockRejectedValue(Object.assign(new Error('gone'), { code: 'not_found' }))
    await expect(restoreWindowSession(remote as never, '/p', 's', null)).rejects.toBeInstanceOf(RestoreRejectedError)
  })
})
