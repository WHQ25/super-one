import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { ControlLease } from '@superone/shared/environment/lease'
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
    acquireControl: vi.fn(async (_ref?: unknown, options?: { after?: Promise<unknown> }): Promise<ControlLease> => {
      if (options?.after) await options.after
      order.push('acquire')
      return { leaseId: 'lease', resource: { environmentId: 'desk', sessionId: 's' }, holderClientId: 'desktop:desk', generation: '1', expiresAt: new Date(Date.now() + 60_000).toISOString() }
    }), followSession: vi.fn(async () => { order.push('subscribe') }),
    followedSession: vi.fn((): { environmentId: string; sessionId: string } | null => null),
    releaseControl: vi.fn(async () => {}),
  }
}

describe('restoreWindowSession', () => {
  it('reads the window at one cursor before acquiring control and following it', async () => {
    const remote = host(conversation(6))
    const restored = await restoreWindowSession(remote as never, '/p', 's', null, { viewport: { width: 390, height: 844 } })
    expect(remote.order).toEqual(['buffer', 'stop', 'acquire', 'session.transcriptWindow', 'environment.descriptor', 'subscribe'])
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

  it.each([
    ['older than the method', { code: 'not_found', message: 'unknown method: session.transcriptWindow' }],
    ['without the port', { code: 'not_found', message: 'unsupported method on this environment: session.transcriptWindow', details: { method: 'session.transcriptWindow', unsupported: true } }],
  ])('reports a host %s so the caller restores the legacy way', async (_name, refusal) => {
    const remote = host([])
    remote.rpc.mockImplementation(async (method: string) => {
      if (method === 'environment.descriptor') return { capabilities: { methods: [] } }
      throw Object.assign(new Error(refusal.message), refusal)
    })
    await expect(restoreWindowSession(remote as never, '/p', 's', null)).rejects.toBeInstanceOf(TranscriptWindowUnsupportedError)
    expect(remote.releaseBuffer).toHaveBeenCalled()
    expect(remote.stopSession).toHaveBeenCalledTimes(2)
  })

  it('keeps stop ahead of acquire when the feed is already on this session', async () => {
    const remote = host(conversation(1))
    let finishStop!: () => void
    const stopped = new Promise<void>((resolve) => { finishStop = resolve })
    let followed: { environmentId: string; sessionId: string } | null = { environmentId: 'desk', sessionId: 's' }
    remote.stopSession.mockImplementation(() => {
      remote.order.push('stop')
      followed = null
      return stopped
    })
    remote.followedSession.mockImplementation(() => followed)
    const opening = restoreWindowSession(remote as never, '/p', 's', null)
    await vi.waitFor(() => expect(remote.order).toContain('session.transcriptWindow'))
    // Registered while stop runs, so a send waits for this grant instead of failing.
    expect(remote.acquireControl).toHaveBeenCalledWith({ environmentId: 'desk', sessionId: 's' }, { after: expect.any(Promise) })
    expect(remote.order).not.toContain('acquire')
    finishStop()
    const restored = await opening
    expect(restored.metrics).toMatchObject({ stopMs: expect.any(Number), windowMs: expect.any(Number), acquireMs: expect.any(Number) })
    expect(remote.order.indexOf('acquire')).toBeGreaterThan(remote.order.indexOf('stop'))
    expect(remote.order.indexOf('subscribe')).toBeGreaterThan(remote.order.indexOf('acquire'))
  })

  it('releases a grant that arrives after the open aborts', async () => {
    const remote = host(conversation(1))
    const controller = new AbortController()
    const lease = { leaseId: 'grant', resource: { environmentId: 'desk', sessionId: 's' }, holderClientId: 'desktop:desk', delegate: 'phone:a', generation: '9', expiresAt: new Date(Date.now() + 60_000).toISOString() }
    let grant!: (value: ControlLease) => void
    remote.acquireControl.mockImplementation(() => {
      remote.order.push('acquire')
      return new Promise<ControlLease>((resolve) => { grant = resolve })
    })
    remote.releaseControl = vi.fn(async () => { remote.order.push('release') })
    remote.rpc.mockImplementation(async (method: string) => {
      remote.order.push(method)
      if (method === 'environment.descriptor') return { capabilities: { methods: [] } }
      controller.abort()
      setTimeout(() => grant(lease), 0)
      return { sessionId: 's', schema: 1, messages: [], total: 1, cursor, state: { status: 'idle' } }
    })
    await expect(restoreWindowSession(remote as never, '/p', 's', null, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(remote.releaseControl).toHaveBeenCalledWith({ environmentId: 'desk', sessionId: 's' }, { leaseId: 'grant', generation: '9' })
    expect(remote.followSession).not.toHaveBeenCalled()
  })

  it('maps host refusals', async () => {
    const remote = host([])
    remote.rpc.mockRejectedValue(Object.assign(new Error('gone'), { code: 'not_found' }))
    await expect(restoreWindowSession(remote as never, '/p', 's', null)).rejects.toBeInstanceOf(RestoreRejectedError)
  })
})
