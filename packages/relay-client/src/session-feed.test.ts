import { expect, it, vi } from 'vitest'
import type { RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import type { SessionStreamFrame } from '@superone/shared/environment/events'
import { PhoneSessionFeed } from './session-feed'

const session = { environmentId: 'desk', sessionId: 's' }
const input = { session, projectPath: '/app', cursor: { sequence: '5', epoch: 'epoch', version: 10 } }
function frame(version = 11, environmentId = 'desk'): SessionStreamFrame {
  return { sequence: '6', epoch: 'epoch', events: [{ eventId: `e${version}`, sequence: '6', timestamp: 1, environmentId, aggregateType: 'session', aggregateId: 's', eventType: 'session.agent_event', eventVersion: 1, sessionVersion: version, payload: { event: { type: 'status_change', status: 'streaming' } } }] }
}
it('maps pushes arriving before the subscribe receipt and filters versions and foreign sources', async () => {
  const deliver = vi.fn(), recover = vi.fn()
  const feed = new PhoneSessionFeed(async (_input, handlers) => {
    handlers.onFrame(frame(10)); handlers.onFrame(frame(11, 'other')); handlers.onFrame(frame(11)); handlers.onFrame(frame(11))
    return { close: vi.fn(), update: vi.fn() }
  }, deliver, recover)
  await feed.follow(input)
  expect(deliver).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ type: 'status_change', environmentId: 'desk', sessionId: 's', projectPath: '/app', seq: 11 })])
  expect(recover).not.toHaveBeenCalled()
})
it('realigns once after coverage loss and ignores subsequent obsolete frames', async () => {
  let handlers!: RpcStreamHandlers
  const deliver = vi.fn(), recover = vi.fn()
  const feed = new PhoneSessionFeed(async (_input, next) => { handlers = next; return { close: vi.fn(), update: vi.fn() } }, deliver, recover)
  await feed.follow(input)
  handlers.onFrame({ ...frame(), recover: [{ kind: 'session', ...session }] })
  handlers.onFrame(frame(12)); handlers.onFrame({ ...frame(), epoch: 'other' })
  expect(recover).toHaveBeenCalledExactlyOnceWith(session)
  expect(deliver).not.toHaveBeenCalled()
  feed.reset(); handlers.onFrame(frame(13)); handlers.onEnd(new Error('closed'))
  expect(recover).toHaveBeenCalledTimes(1)
})
it('retires the previous stream and cannot route its later push into the next transcript', async () => {
  const handlers: RpcStreamHandlers[] = [], closed = vi.fn(), deliver = vi.fn()
  const feed = new PhoneSessionFeed(async (_input, next) => { handlers.push(next); return { close: async () => { closed() }, update: vi.fn() } }, deliver, vi.fn())
  await feed.follow(input)
  await feed.follow({ ...input, session: { ...session, sessionId: 'next' } })
  expect(closed).toHaveBeenCalledOnce()
  handlers[0]!.onFrame(frame())
  expect(deliver).not.toHaveBeenCalled()
})
it('does not open a replacement after cancellation while the previous stream is closing', async () => {
  let finish!: () => void
  const close = vi.fn().mockResolvedValue(undefined)
  const subscribe = vi.fn(async () => ({ close, update: vi.fn() }))
  const release = vi.fn().mockResolvedValue(undefined)
  const feed = new PhoneSessionFeed(subscribe, vi.fn(), vi.fn(), () => release)
  await feed.follow(input)
  close.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
  const following = feed.follow(input)
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
  await feed.stop()
  finish()
  await following
  expect(subscribe).toHaveBeenCalledOnce()
  expect(release).toHaveBeenCalledTimes(2)
})
it('retains the next use before retiring the previous use of the same grant', async () => {
  let uses = 0
  const lost = vi.fn()
  const retain = () => { uses++; return async () => { if (--uses === 0) lost() } }
  const feed = new PhoneSessionFeed(async () => ({ close: vi.fn(), update: vi.fn() }), vi.fn(), vi.fn(), retain)
  await feed.follow(input)
  await feed.follow(input)
  expect(uses).toBe(1)
  expect(lost).not.toHaveBeenCalled()
  await feed.stop()
  expect(lost).toHaveBeenCalledOnce()
})
