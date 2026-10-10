import { describe, expect, it, vi } from 'vitest'
import type { RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import { topicKey, type TopicVersionCursor } from '@superone/shared/environment/topics'
import { PhoneWorkspaceFeed } from './workspace-feed'

const list = { kind: 'sessionList', environmentId: 'env' } as const
const cursor = (version: number) => ({ epoch: 'epoch', version })
const event = { type: 'session_list_changed', projectPath: '/p' } as const
function setup() {
  let handlers!: RpcStreamHandlers
  const close = vi.fn().mockResolvedValue(undefined)
  const subscribe = vi.fn(async (_input, next: RpcStreamHandlers) => { handlers = next; return { close, update: vi.fn() } })
  const hooks = { onSnapshot: vi.fn(), onEvents: vi.fn(), onTerminal: vi.fn(), onRecover: vi.fn() }
  const feed = new PhoneWorkspaceFeed(subscribe, hooks)
  return { feed, subscribe, close, hooks, handlers: () => handlers }
}

describe('native phone workspace feed', () => {
  it('applies the initial snapshot and subsequent changes without touching session frames', async () => {
    const f = setup()
    await f.feed.follow('env')
    f.handlers().onTopic!({ topic: list, cursor: cursor(0), events: [], snapshot: { sessions: [] } })
    f.handlers().onTopic!({ topic: list, cursor: cursor(1), events: [event] })
    f.handlers().onFrame({ sequence: '99', epoch: 'unrelated', events: [] })
    expect(f.hooks.onSnapshot).toHaveBeenCalledWith(list, { sessions: [] })
    expect(f.hooks.onEvents).toHaveBeenCalledWith([{ ...event, environmentId: 'env' }])
    expect(f.hooks.onRecover).not.toHaveBeenCalled()
    await f.feed.stop()
  })

  it('resumes from a retained per-topic cursor and ignores duplicate change packets', async () => {
    const f = setup()
    const topicCursors = { [topicKey(list)]: cursor(2) }
    await f.feed.follow('env', topicCursors)
    f.handlers().onTopic!({ topic: list, cursor: cursor(4), events: [event, event] })
    f.handlers().onTopic!({ topic: list, cursor: cursor(4), events: [event, event] })
    expect(f.hooks.onEvents).toHaveBeenCalledOnce()
    expect(f.subscribe).toHaveBeenCalledWith(expect.objectContaining({ topicCursors }), expect.any(Object))
    await f.feed.stop()
  })

  it('advances a compacted draft span before an immediate deletion without mistaking it for lost versions', async () => {
    const f = setup()
    const drafts = { kind: 'drafts', environmentId: 'env' } as const
    await f.feed.follow('env')
    f.handlers().onTopic!({ topic: drafts, cursor: cursor(2), events: [], snapshot: { drafts: [] } })
    f.handlers().onTopic!({ topic: drafts, cursor: cursor(7), afterVersion: 2, events: [{ type: 'draft_changed', draftId: 'a', reason: 'saved' }] })
    f.handlers().onTopic!({ topic: drafts, cursor: cursor(8), afterVersion: 7, events: [] })
    f.handlers().onTopic!({ topic: drafts, cursor: cursor(9), events: [{ type: 'draft_changed', draftId: 'a', reason: 'deleted' }] })
    expect(f.hooks.onRecover).not.toHaveBeenCalled()
    expect(f.hooks.onEvents).toHaveBeenCalledTimes(2)
    await f.feed.stop()
  })

  it.each([-1, 1, 2.5])('recovers a compacted draft span whose base %s is not the applied cursor', async afterVersion => {
    const f = setup()
    const drafts = { kind: 'drafts', environmentId: 'env' } as const
    await f.feed.follow('env')
    f.handlers().onTopic!({ topic: drafts, cursor: cursor(2), events: [], snapshot: {} })
    f.handlers().onTopic!({ topic: drafts, cursor: cursor(7), afterVersion, events: [] })
    expect(f.hooks.onRecover).toHaveBeenCalledWith(drafts, undefined)
    await f.feed.stop()
  })

  it.each(['gap', 'epoch'])('requests one scoped recovery on a %s and suppresses later partial changes', async problem => {
    const f = setup()
    await f.feed.follow('env')
    f.handlers().onTopic!({ topic: list, cursor: cursor(0), events: [], snapshot: {} })
    f.handlers().onTopic!({ topic: list, cursor: problem === 'gap' ? cursor(2) : { epoch: 'other', version: 1 }, events: [event] })
    f.handlers().onTopic!({ topic: list, cursor: cursor(3), events: [event] })
    expect(f.hooks.onRecover).toHaveBeenCalledOnce()
    expect(f.hooks.onRecover).toHaveBeenCalledWith(list, undefined)
    expect(f.hooks.onEvents).not.toHaveBeenCalled()
    await f.feed.stop()
  })

  it('keeps versions independent across topic kinds and drops another environment', async () => {
    const f = setup()
    await f.feed.follow('env')
    const projects = { kind: 'projects', environmentId: 'env' } as const
    for (const topic of [list, projects]) f.handlers().onTopic!({ topic, cursor: cursor(0), events: [], snapshot: {} })
    f.handlers().onTopic!({ topic: { ...list, environmentId: 'other' }, cursor: cursor(5), events: [event] })
    f.handlers().onTopic!({ topic: projects, cursor: cursor(1), events: [{ type: 'project_list_changed' }] })
    expect(f.hooks.onRecover).not.toHaveBeenCalled()
    expect(f.hooks.onEvents).toHaveBeenCalledOnce()
    await f.feed.stop()
  })

  it('forwards terminal list metadata without duplicating the selected output feed', async () => {
    const f = setup()
    await f.feed.follow('env')
    f.handlers().onTerminal!({ type: 'terminal_title_changed', terminalId: 't', title: 'vim' })
    f.handlers().onTerminal!({ type: 'terminal_output', terminalId: 't', data: 'ignored', fromSeq: 1, toSeq: 1, createdAt: 0 })
    expect(f.hooks.onTerminal).toHaveBeenCalledOnce()
    await f.feed.stop()
  })

  it('closes a subscription whose receipt arrives after cancellation', async () => {
    let resolve!: (stream: { close(): Promise<void>; update(): Promise<void> }) => void
    const pending = new Promise<{ close(): Promise<void>; update(): Promise<void> }>(ok => { resolve = ok })
    const close = vi.fn().mockResolvedValue(undefined)
    const hooks = { onSnapshot: vi.fn(), onEvents: vi.fn(), onTerminal: vi.fn(), onRecover: vi.fn() }
    const subscribe = vi.fn(() => pending)
    const feed = new PhoneWorkspaceFeed(subscribe, hooks)
    const following = feed.follow('env')
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledOnce())
    await feed.stop()
    resolve({ close, update: vi.fn() })
    await following
    expect(close).toHaveBeenCalledOnce()
  })

  it('does not open a replacement after cancellation while the previous stream is closing', async () => {
    const f = setup()
    await f.feed.follow('env')
    let finish!: () => void
    f.close.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
    const replacing = f.feed.follow('env')
    await vi.waitFor(() => expect(f.close).toHaveBeenCalledOnce())
    await f.feed.stop()
    finish()
    await replacing
    expect(f.subscribe).toHaveBeenCalledOnce()
  })

  it('ends once with the stream and ignores callbacks from a retired stream', async () => {
    const f = setup()
    await f.feed.follow('env')
    const old = f.handlers()
    await f.feed.follow('env')
    old.onEnd(new Error('old stream'))
    f.handlers().onEnd(new Error('gone'))
    f.handlers().onEnd(new Error('again'))
    expect(f.hooks.onRecover).toHaveBeenCalledOnce()
    expect(f.hooks.onRecover).toHaveBeenCalledWith({ kind: 'environment', environmentId: 'env' }, expect.objectContaining({ message: 'gone' }))
    await f.feed.stop()
  })
})
