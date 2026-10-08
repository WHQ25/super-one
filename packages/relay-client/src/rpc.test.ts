import { describe, expect, it, vi } from 'vitest'
import type { RemoteCommand } from '@superone/shared/agent-types'
import { RpcInbox } from './rpc'

describe('RpcInbox', () => {
  it('registers the request before sending', async () => {
    const inbox = new RpcInbox(() => 'generated')
    const result = inbox.begin(
      { type: 'list_projects', requestId: 'sync' } as RemoteCommand,
      () => inbox.complete('sync', { ok: true }),
    )
    await expect(result).resolves.toEqual({ ok: true })
  })

  it('rejects duplicate pending request ids', async () => {
    vi.useFakeTimers()
    const inbox = new RpcInbox()
    const first = inbox.begin(
      { type: 'list_projects', requestId: 'same' } as RemoteCommand,
      () => {},
      100,
    )
    await expect(inbox.begin(
      { type: 'list_projects', requestId: 'same' } as RemoteCommand,
      () => {},
    )).rejects.toThrow('already pending')
    vi.advanceTimersByTime(100)
    await expect(first).rejects.toThrow('rpc timeout')
    vi.useRealTimers()
  })

  it('rejects malformed, unknown, and inconsistent chunk envelopes', async () => {
    const inbox = new RpcInbox()
    expect(() => inbox.ingestChunk('r', -1, 2, 'a')).toThrow('invalid rpc chunk index')
    expect(() => inbox.ingestChunk('r', 0, 20_000, 'a')).toThrow('invalid rpc chunk total')
    expect(() => inbox.ingestChunk('missing', 0, 1, 'a')).toThrow('unknown rpc chunk request')
    const pending = inbox.begin(
      { type: 'list_projects', requestId: 'r' } as RemoteCommand,
      () => {},
    )
    expect(inbox.ingestChunk('r', 0, 2, 'a')).toBeNull()
    expect(() => inbox.ingestChunk('r', 1, 3, 'b')).toThrow('chunk total changed')
    inbox.fail('r', new Error('invalid chunks'))
    await expect(pending).rejects.toThrow('invalid chunks')
  })

  it('assembles out-of-order chunks for a pending request', async () => {
    const inbox = new RpcInbox()
    const pending = inbox.begin(
      { type: 'list_projects', requestId: 'chunks' } as RemoteCommand,
      () => {},
    )
    expect(inbox.ingestChunk('chunks', 1, 2, 'b')).toBeNull()
    const assembled = inbox.ingestChunk('chunks', 0, 2, 'a')
    expect(assembled).toBe('ab')
    inbox.complete('chunks', assembled)
    await expect(pending).resolves.toBe('ab')
  })
  it('bounds chunk memory and rejects conflicting duplicate chunks', async () => {
    const inbox = new RpcInbox()
    const pending = inbox.begin({ type: 'list_projects', requestId: 'bounded' }, () => {})
    expect(() => inbox.ingestChunk('bounded', 0, 2, 'a'.repeat(800_001))).toThrow('chunk size')
    expect(inbox.ingestChunk('bounded', 0, 2, 'a')).toBeNull()
    expect(inbox.ingestChunk('bounded', 0, 2, 'a')).toBeNull()
    expect(() => inbox.ingestChunk('bounded', 0, 2, 'b')).toThrow('conflicting')
    inbox.fail('bounded', new Error('invalid chunks'))
    await expect(pending).rejects.toThrow('invalid chunks')
  })

})
