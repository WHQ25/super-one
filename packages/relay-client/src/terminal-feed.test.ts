import { describe, expect, it, vi } from 'vitest'
import type { TerminalEvent, TerminalSnapshot } from '@superone/shared/agent-types'
import type { RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import { PhoneTerminalFeed } from './terminal-feed'

const resource = { environmentId: 'env', terminalId: 't' }
const meta: TerminalSnapshot = { terminalId: 't', cwd: '/p', title: 'shell', status: 'running', cols: 80, rows: 24, lastSeq: 2, ownerDeviceId: null, writableByMe: false, subscriberCount: 0 }
const attached = (sequence: number, snapshot = 'screen') => ({ snapshot, sequence: String(sequence), terminal: { ...meta, lastSeq: sequence } })
const output = (sequence: number, data: string): TerminalEvent => ({ type: 'terminal_output', terminalId: 't', fromSeq: sequence, toSeq: sequence, data, createdAt: 0 })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}
function setup(attach = vi.fn().mockResolvedValue(attached(2))) {
  let handlers!: RpcStreamHandlers
  const close = vi.fn().mockResolvedValue(undefined)
  const emit = vi.fn()
  const end = vi.fn()
  const subscribe = vi.fn(async (_input, next: RpcStreamHandlers) => { handlers = next; return { close, update: vi.fn() } })
  const feed = new PhoneTerminalFeed(resource, { subscribe, attach }, emit, end)
  return { feed, attach, subscribe, close, emit, end, push: (event: TerminalEvent) => handlers.onTerminal!(event), handlers: () => handlers }
}

describe('native phone terminal feed', () => {
  it('buffers pushes before the attach receipt and drops output covered by its cut', async () => {
    const pending = deferred<ReturnType<typeof attached>>()
    const f = setup(vi.fn(() => pending.promise))
    await vi.waitFor(() => expect(f.attach).toHaveBeenCalledOnce())
    f.push(output(1, 'covered'))
    f.push(output(2, 'also covered'))
    f.push(output(3, 'new'))
    pending.resolve(attached(2))
    await f.feed.ready
    expect(f.emit.mock.calls.map(([event]) => event.type)).toEqual(['terminal_snapshot', 'terminal_output'])
    expect(f.emit).toHaveBeenLastCalledWith(output(3, 'new'))
    f.push(output(3, 'duplicate'))
    expect(f.emit).toHaveBeenCalledTimes(2)
  })

  it('resnapshots a sequence gap without displaying an incomplete screen', async () => {
    const f = setup(vi.fn().mockResolvedValueOnce(attached(2)).mockResolvedValueOnce(attached(5, 'caught up')))
    await f.feed.ready
    f.push(output(5, 'gap'))
    await vi.waitFor(() => expect(f.emit).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'terminal_snapshot', ansi: 'caught up' })))
    f.push(output(6, 'next'))
    expect(f.emit).toHaveBeenLastCalledWith(output(6, 'next'))
    expect(f.emit.mock.calls.some(([event]) => event.data === 'gap')).toBe(false)
  })

  it('ignores another terminal and retains metadata for this terminal', async () => {
    const f = setup()
    await f.feed.ready
    f.emit.mockClear()
    f.push({ ...output(3, 'secret'), terminalId: 'other' })
    f.push({ type: 'terminal_owner_changed', terminalId: 't', ownerDeviceId: 'b', writableByMe: false })
    expect(f.emit).toHaveBeenCalledOnce()
    expect(f.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'terminal_owner_changed' }))
  })

  it('closes a subscription whose open receipt arrives after cancellation', async () => {
    const pending = deferred<{ close(): Promise<void>; update(): Promise<void> }>()
    const close = vi.fn().mockResolvedValue(undefined)
    const attach = vi.fn()
    const emit = vi.fn()
    const feed = new PhoneTerminalFeed(resource, { subscribe: () => pending.promise, attach }, emit, vi.fn())
    await feed.close()
    pending.resolve({ close, update: vi.fn() })
    await feed.ready
    expect(close).toHaveBeenCalledOnce()
    expect(attach).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('does not paint a late snapshot after the view closes', async () => {
    const pending = deferred<ReturnType<typeof attached>>()
    const f = setup(vi.fn(() => pending.promise))
    await vi.waitFor(() => expect(f.attach).toHaveBeenCalled())
    await f.feed.close()
    pending.resolve(attached(2))
    await f.feed.ready
    expect(f.emit).not.toHaveBeenCalled()
    expect(f.close).toHaveBeenCalledOnce()
  })

  it('ends once and closes the stream when a snapshot is refused', async () => {
    const f = setup(vi.fn().mockRejectedValue(new Error('not found')))
    await expect(f.feed.ready).rejects.toThrow('not found')
    await vi.waitFor(() => expect(f.close).toHaveBeenCalledOnce())
    f.handlers().onEnd(new Error('gone'))
    expect(f.end).toHaveBeenCalledOnce()
    expect(f.emit).not.toHaveBeenCalled()
  })

  it('rejects a snapshot from a different terminal', async () => {
    const f = setup(vi.fn().mockResolvedValue({ ...attached(2), terminal: { ...meta, terminalId: 'other' } }))
    await expect(f.feed.ready).rejects.toThrow('invalid terminal snapshot')
    expect(f.emit).not.toHaveBeenCalled()
  })

  it('bounds pre-snapshot output and obtains a newer screen after overflow', async () => {
    const pending = deferred<ReturnType<typeof attached>>()
    const f = setup(vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValueOnce(attached(3, 'latest')))
    await vi.waitFor(() => expect(f.attach).toHaveBeenCalledOnce())
    f.push(output(3, 'x'.repeat(512 * 1_024 + 1)))
    pending.resolve(attached(2))
    await f.feed.ready
    expect(f.attach).toHaveBeenCalledTimes(2)
    expect(f.emit).toHaveBeenLastCalledWith(expect.objectContaining({ ansi: 'latest' }))
    expect(f.emit.mock.calls.some(([event]) => event.type === 'terminal_output')).toBe(false)
  })
})
