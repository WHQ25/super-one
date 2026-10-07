import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvironmentGateway } from '@superone/shared/environment'
import { executeEnvironmentCommand, releaseEnvironmentDevice } from './environment-commands'
import { routedHistory } from './environment-session-view'

const m = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), project: vi.fn(), acquire: vi.fn(), release: vi.fn(), renew: vi.fn(), bootstrap: vi.fn(), send: vi.fn() }))
vi.mock('../environment/environment-host', () => ({ getEnvironmentHost: () => ({ listEnvironments: m.list, getGateway: () => gateway }) }))
vi.mock('./environment-session-resources', () => ({ routedResources: vi.fn() }))
const ref = { environmentId: 'node', sessionId: 'same' }
const gateway = {
  sessions: { get: m.get, acquireControl: m.acquire, releaseControl: m.release, renewControl: m.renew, linkBootstrap: m.bootstrap, send: m.send }, getProject: m.project,
  async *subscribeEvents(input: { signal: AbortSignal }) { await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true })) },
}
beforeEach(async () => {
  await releaseEnvironmentDevice('phone')
  vi.clearAllMocks()
  m.list.mockResolvedValue([{ environmentId: 'node', connectionId: 'route', kind: 'remote' }])
  m.get.mockResolvedValue({ projectId: 'p', harnessId: 'acp', providerId: 'grok', status: 'idle' })
  m.project.mockResolvedValue({ path: '/app' })
  m.acquire.mockResolvedValue({ leaseId: 'lease', generation: 4 })
  m.release.mockResolvedValue(undefined)
  m.renew.mockResolvedValue({ leaseId: 'lease', generation: 4 })
  m.bootstrap.mockResolvedValue({ snapshot: { projectId: 'p', harnessId: 'acp', status: 'idle' }, page: { messages: [], cursor: null, hasMore: false }, sequence: '42' })
})
describe('paired phone environment route', () => {
  it('requires the explicit owning project before acquiring control', async () => {
    await expect(executeEnvironmentCommand('node', { type: 'subscribe_session', requestId: 'r', projectPath: '/other', sessionId: 'same' }, 'phone', vi.fn())).rejects.toThrow('project mismatch')
    expect(m.acquire).not.toHaveBeenCalled()
  })
  it('prepares a baseline, retains images and turn settings, and cleans up after host removal', async () => {
    const result = await executeEnvironmentCommand('node', { type: 'subscribe_session', requestId: 'r', projectPath: '/app', sessionId: 'same' }, 'phone', vi.fn())
    expect(result).toMatchObject({ snapshot: { sourceEnvironmentId: 'node' } })
    const images = [{ id: 'img', name: 'a.png', mimeType: 'image/png', base64: 'AA==' }]
    await executeEnvironmentCommand('node', { type: 'send_message', projectPath: '/app', sessionId: 'same', content: 'Hello', images, model: 'actual-model', serviceTier: 'fast', inputRequest: { requestId: 'form', answers: {} } } as never, 'phone', vi.fn())
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ session: ref, leaseId: 'lease', generation: 4, options: expect.objectContaining({ images, model: 'actual-model', serviceTier: 'fast', inputRequest: expect.anything() }) }))
    m.list.mockResolvedValue([])
    await executeEnvironmentCommand('node', { type: 'unsubscribe_session', sessionId: 'same' }, 'phone', vi.fn())
    expect(m.release).toHaveBeenCalledWith(expect.objectContaining({ leaseId: 'lease' }))
  })
  it('releases a newly acquired lease on a failed bootstrap', async () => {
    m.bootstrap.mockRejectedValue(new Error('offline'))
    await expect(executeEnvironmentCommand('node', { type: 'subscribe_session', requestId: 'r', projectPath: '/app', sessionId: 'same' }, 'phone', vi.fn())).rejects.toThrow('offline')
    expect(m.release).toHaveBeenCalledOnce()
  })
})
describe('routed history anchors', () => {
  it('never repeats older messages in a short page after an anchor near the end', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: String(i), role: 'user' as const, text: String(i), sortOrder: i, createdAt: i + 1 }))
    const listMessages = vi.fn(async (input: { cursor?: string | number | null; limit?: number }) => {
      const end = input.cursor == null ? rows.length : Math.min(rows.length, Number(input.cursor))
      const start = Math.max(0, end - (input.limit ?? 24))
      return { sessionId: 'same', messages: rows.slice(start, end), cursor: start ? String(start) : null, hasMore: start > 0 }
    })
    const historyGateway = { sessions: { listMessages } } as unknown as EnvironmentGateway
    const page = await routedHistory(historyGateway, ref, 'acp', { anchorId: '4', direction: 'after', limit: 24 })
    expect(page.messages.map(row => row.id)).toEqual(['5'])
    expect(page).toMatchObject({ startIndex: 5, endIndex: 6, totalCount: 6 })
    expect((await routedHistory(historyGateway, ref, 'acp', { anchorId: '5', direction: 'after' })).messages).toEqual([])
    expect((await routedHistory(historyGateway, ref, 'acp', { anchorId: '0', direction: 'before' })).messages).toEqual([])
  })
})
