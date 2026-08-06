import { describe, expect, it, vi } from 'vitest'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { MessageBridge } from './message-bridge'

function userMsg(text: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    uuid: '00000000-0000-4000-8000-000000000001',
    session_id: 's1',
  } as SDKUserMessage
}

describe('MessageBridge', () => {
  it('delivers a queued push to a waiting consumer', async () => {
    const bridge = new MessageBridge()
    const iter = bridge[Symbol.asyncIterator]()
    const nextP = iter.next()
    bridge.push(userMsg('hi'), 'tag-1')
    const result = await nextP
    expect(result.done).toBe(false)
    expect((result.value as SDKUserMessage).message.content).toBe('hi')
    expect(bridge.consumedTags).toEqual(['tag-1'])
  })

  it('buffers push until next() is called', async () => {
    const bridge = new MessageBridge()
    bridge.push(userMsg('a'), 'a')
    bridge.push(userMsg('b'), 'b')
    const iter = bridge[Symbol.asyncIterator]()
    const first = await iter.next()
    const second = await iter.next()
    expect((first.value as SDKUserMessage).message.content).toBe('a')
    expect((second.value as SDKUserMessage).message.content).toBe('b')
    expect(bridge.consumedTags).toEqual(['a', 'b'])
  })

  it('close ends a waiting next()', async () => {
    const bridge = new MessageBridge()
    const iter = bridge[Symbol.asyncIterator]()
    const nextP = iter.next()
    bridge.close()
    const result = await nextP
    expect(result.done).toBe(true)
    expect(bridge.isClosed).toBe(true)
  })

  it('invokes onConsumed when a tagged message is delivered', async () => {
    const bridge = new MessageBridge()
    const onConsumed = vi.fn()
    bridge.onConsumed = onConsumed
    bridge.push(userMsg('x'), 'cid-1')
    const iter = bridge[Symbol.asyncIterator]()
    await iter.next()
    expect(onConsumed).toHaveBeenCalledWith('cid-1')
  })

  it('ignores push after close', async () => {
    const bridge = new MessageBridge()
    bridge.close()
    bridge.push(userMsg('late'), 'late')
    const iter = bridge[Symbol.asyncIterator]()
    const result = await iter.next()
    expect(result.done).toBe(true)
  })
})
