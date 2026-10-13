import { describe, expect, it, vi } from 'vitest'
import { OpenCodeInbox } from './opencode-inbox'
import type { OpenCodeV2Inbox } from './opencode-v2-types'

const input = { id: 'input', type: 'user', delivery: 'queue', payload: { text: 'next', files: [{ uri: 'private', name: 'attachment' }] }, time: { created: 1 } } as OpenCodeV2Inbox
function fixture() {
  const abort = new AbortController(), publish = vi.fn()
  const client = { inbox: vi.fn(async () => [input]), cancelInbox: vi.fn(async (_session, _id, guard) => guard()),
    updateInbox: vi.fn(async (_session, _id, _delivery, guard) => guard()) }
  return { abort, publish, client, inbox: new OpenCodeInbox(client, 'native', abort.signal, publish) }
}

describe('native pending user input', () => {
  it('publishes user inputs without control items, file paths or metadata', async () => {
    const { client, inbox } = fixture()
    client.inbox.mockResolvedValueOnce([input, { ...input, id: 'internal', type: 'compaction' } as OpenCodeV2Inbox])
    expect(await inbox.refresh()).toEqual([{ id: 'input', text: 'next', delivery: 'queue', createdAt: 1, attachmentCount: 1 }])
  })
  it.each(['cancel', 'update'] as const)('refuses a %s after the native item has already been delivered', async (operation) => {
    const { client, inbox } = fixture()
    await inbox.refresh()
    client.inbox.mockResolvedValueOnce([])
    await expect(operation === 'cancel' ? inbox.cancel('input', vi.fn()) : inbox.update('input', 'steer', vi.fn())).rejects.toThrow('no longer pending')
    expect(client.cancelInbox).not.toHaveBeenCalled(); expect(client.updateInbox).not.toHaveBeenCalled()
  })
  it('checks the captured control proof at the SDK mutation after an asynchronous pending read', async () => {
    const { client, inbox } = fixture()
    let finish!: (items: OpenCodeV2Inbox[]) => void
    client.inbox.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    let valid = true
    const update = inbox.update('input', 'steer', () => { if (!valid) throw new Error('stale lease') })
    const rejected = expect(update).rejects.toThrow('stale lease')
    valid = false; finish([input]); await rejected
    expect(client.updateInbox).toHaveBeenCalledOnce()
  })
  it('coalesces reads and refreshes a change that arrived during the read', async () => {
    const { client, inbox, publish } = fixture()
    let finish!: (items: OpenCodeV2Inbox[]) => void
    client.inbox.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockResolvedValueOnce([])
    const first = inbox.refresh(), same = inbox.refresh()
    expect(same).toBe(first)
    finish([input]); await first
    await vi.waitFor(() => expect(publish).toHaveBeenLastCalledWith([]))
    expect(client.inbox).toHaveBeenCalledTimes(2)
  })
  it('does not publish or mutate after the runtime closes', async () => {
    const { abort, inbox, publish, client } = fixture()
    abort.abort()
    await expect(inbox.refresh()).rejects.toThrow()
    await expect(inbox.cancel('input', vi.fn())).rejects.toThrow()
    expect(publish).not.toHaveBeenCalled(); expect(client.cancelInbox).not.toHaveBeenCalled()
  })
})
