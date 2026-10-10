import { afterEach, describe, expect, it, vi } from 'vitest'
import { RpcInbox } from './rpc-inbox'

afterEach(() => vi.useRealTimers())

describe('shared RPC inbox', () => {
  it('keeps a protocol request pending without an optional deadline', async () => {
    vi.useFakeTimers()
    const inbox = new RpcInbox(() => 'r')
    const pending = inbox.begin<number>({ method: 'session.load' }, () => {}, null)
    vi.advanceTimersByTime(60_000)
    inbox.complete('r', 1)
    await expect(pending).resolves.toBe(1)
  })

  it('forgets a failed send before the id is reused', async () => {
    const inbox = new RpcInbox()
    await expect(inbox.begin({ requestId: 'r' }, () => {
      throw new Error('send failed')
    })).rejects.toThrow('send failed')
    const pending = inbox.begin({ requestId: 'r' }, () => {})
    inbox.complete('r', true)
    await expect(pending).resolves.toBe(true)
  })

  it('uses the client timeout error and ignores a late receipt', async () => {
    vi.useFakeTimers()
    const inbox = new RpcInbox(() => 'r')
    const onTimeout = vi.fn()
    const pending = inbox.begin({ method: 'session.load' }, () => {}, 10, { timeoutError: () => Object.assign(new Error('late'), { code: 'deadline_exceeded' }), onTimeout })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'deadline_exceeded' })
    vi.advanceTimersByTime(10)
    await rejected
    expect(onTimeout).toHaveBeenCalledOnce()
    expect(inbox.has('r')).toBe(false)
    inbox.complete('r', 'late')
    expect(onTimeout).toHaveBeenCalledOnce()
  })

  it('rejects a duplicate pending id without replacing its receipt', async () => {
    const inbox = new RpcInbox(() => 'r')
    const send = vi.fn()
    const first = inbox.begin({ method: 'session.load' }, send)
    await expect(inbox.begin({ method: 'session.load' }, send)).rejects.toThrow('already pending')
    inbox.complete('r', 1)
    await expect(first).resolves.toBe(1)
    expect(send).toHaveBeenCalledOnce()
  })

  it('ends every pending receipt on close', async () => {
    const inbox = new RpcInbox()
    const a = inbox.begin({ requestId: 'a' }, () => {}, null)
    const b = inbox.begin({ requestId: 'b' }, () => {}, null)
    const rejected = Promise.all([expect(a).rejects.toThrow('closed'), expect(b).rejects.toThrow('closed')])
    inbox.failAll(new Error('closed'))
    await rejected
    expect(inbox.has('a')).toBe(false)
    expect(inbox.has('b')).toBe(false)
  })
})
