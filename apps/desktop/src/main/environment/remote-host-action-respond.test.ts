/** A Host Action's effects that wait for its response commit only once the node accepted it. */
import { describe, expect, it, vi } from 'vitest'
import type { ClaimHostActionResult, HostActionPublicView } from '@superone/shared/environment'
import { RemoteHostActionConsumer, type HostActionExecutor } from './remote-host-action-consumer'
import type { NodeRpcClient } from './node-rpc-client'

const action = {
  actionId: 'a1',
  sessionId: 'remote-child',
  state: 'pending',
  version: 1,
  replayPolicy: 'unsafe',
  deadline: 0,
  createdAt: 0,
} as HostActionPublicView

function nodeClient(respond: () => Promise<unknown>) {
  let polled = false
  const rpc = vi.fn(async (method: string) => {
    if (method === 'session.hostActionsPoll') {
      if (polled) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return { changes: [], cursor: '1' }
      }
      polled = true
      return { outstanding: [action], changes: [], cursor: '1' }
    }
    if (method === 'session.claimHostAction') {
      return { actionId: 'a1', claimToken: 't', sessionId: 'remote-child', toolName: 'session_collab_retrieve', args: {} } as unknown as ClaimHostActionResult
    }
    if (method === 'session.respondHostAction') return respond()
    throw new Error(`unexpected ${method}`)
  })
  return { client: { connected: true, rpc } as unknown as NodeRpcClient, rpc }
}

function consume(client: NodeRpcClient, executor: HostActionExecutor) {
  const consumer = new RemoteHostActionConsumer({ connectionId: 'conn-b', client, executor, onError: () => {} })
  consumer.start()
  return consumer
}

describe('RemoteHostActionConsumer response commit', () => {
  it('commits once the node accepted the response', async () => {
    const onResponded = vi.fn()
    const { client } = nodeClient(async () => ({ actionId: 'a1', state: 'succeeded', version: 2, duplicate: false }))
    const consumer = consume(client, async () => ({ outcome: 'succeeded', result: {}, onResponded }))
    await vi.waitFor(() => expect(onResponded).toHaveBeenCalledTimes(1))
    consumer.stop()
    await consumer.waitUntilStopped()
  })

  it('does not commit when the response did not reach the node', async () => {
    const onResponded = vi.fn()
    const { client, rpc } = nodeClient(async () => { throw new Error('transport closed') })
    const consumer = consume(client, async () => ({ outcome: 'succeeded', result: {}, onResponded }))
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith('session.respondHostAction', expect.anything()))
    consumer.stop()
    await consumer.waitUntilStopped()
    expect(onResponded).not.toHaveBeenCalled()
  })

  it('does not commit an action cancelled while it ran', async () => {
    const onResponded = vi.fn()
    const { client, rpc } = nodeClient(async () => ({ actionId: 'a1', state: 'succeeded', version: 2, duplicate: false }))
    let started!: () => void
    const running = new Promise<void>((resolve) => { started = resolve })
    const consumer = consume(client, (_claimed, signal) => new Promise((resolve) => {
      started()
      signal.addEventListener('abort', () => resolve({ outcome: 'succeeded', result: {}, onResponded }), { once: true })
    }))
    await running
    consumer.stop('cancelled')
    await consumer.waitUntilStopped()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(rpc).not.toHaveBeenCalledWith('session.respondHostAction', expect.anything())
    expect(onResponded).not.toHaveBeenCalled()
  })
})
