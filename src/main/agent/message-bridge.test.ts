import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { MessageBridge } from './message-bridge'

const msg = (text: string): SDKUserMessage =>
  ({ role: 'user', content: [{ type: 'text', text }] }) as SDKUserMessage

describe('MessageBridge', () => {
  it('should deliver pushed messages in order via async iterator', async () => {
    const bridge = new MessageBridge()
    bridge.push(msg('a'))
    bridge.push(msg('b'))
    bridge.push(msg('c'))
    bridge.close()

    const results: SDKUserMessage[] = []
    for await (const m of bridge) {
      results.push(m)
    }

    expect(results).toEqual([msg('a'), msg('b'), msg('c')])
  })

  it('should resolve a waiting iterator when a message is pushed', async () => {
    const bridge = new MessageBridge()
    const iter = bridge[Symbol.asyncIterator]()

    const promise = iter.next()
    bridge.push(msg('delayed'))

    const result = await promise
    expect(result).toEqual({ value: msg('delayed'), done: false })
  })

  it('should deliver multiple queued messages in FIFO order', async () => {
    const bridge = new MessageBridge()
    const iter = bridge[Symbol.asyncIterator]()

    bridge.push(msg('1'))
    bridge.push(msg('2'))
    bridge.push(msg('3'))

    expect(await iter.next()).toEqual({ value: msg('1'), done: false })
    expect(await iter.next()).toEqual({ value: msg('2'), done: false })
    expect(await iter.next()).toEqual({ value: msg('3'), done: false })
  })

  it('should yield queued messages then done after close', async () => {
    const bridge = new MessageBridge()
    const iter = bridge[Symbol.asyncIterator]()

    bridge.push(msg('x'))
    bridge.push(msg('y'))
    bridge.close()

    expect(await iter.next()).toEqual({ value: msg('x'), done: false })
    expect(await iter.next()).toEqual({ value: msg('y'), done: false })
    expect((await iter.next()).done).toBe(true)
  })

  it('should ignore push calls after close', async () => {
    const bridge = new MessageBridge()
    bridge.close()
    bridge.push(msg('ignored'))

    const iter = bridge[Symbol.asyncIterator]()
    expect((await iter.next()).done).toBe(true)
  })

  it('should resolve a pending iterator with done when closed', async () => {
    const bridge = new MessageBridge()
    const iter = bridge[Symbol.asyncIterator]()

    const promise = iter.next()
    bridge.close()

    const result = await promise
    expect(result.done).toBe(true)
  })

  it('should handle alternating push and next calls', async () => {
    const bridge = new MessageBridge()
    const iter = bridge[Symbol.asyncIterator]()

    bridge.push(msg('first'))
    expect(await iter.next()).toEqual({ value: msg('first'), done: false })

    const pending = iter.next()
    bridge.push(msg('second'))
    expect(await pending).toEqual({ value: msg('second'), done: false })

    bridge.push(msg('third'))
    bridge.push(msg('fourth'))
    expect(await iter.next()).toEqual({ value: msg('third'), done: false })
    expect(await iter.next()).toEqual({ value: msg('fourth'), done: false })

    bridge.close()
    expect((await iter.next()).done).toBe(true)
  })
})
