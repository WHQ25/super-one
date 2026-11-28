/**
 * A claimed Host Action must survive the socket it was claimed on: claim and
 * respond resend over the next connection with the same key, and the claim is
 * renewed while the tool runs.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { ClaimHostActionResult, HostActionsPollResult } from '@superone/shared/environment'
import type { NodeRpcClient } from './node-rpc-client'
import { RemoteHostActionConsumer, type HostActionExecutor } from './remote-host-action-consumer'

interface Call {
  method: string
  payload: Record<string, unknown>
  commandKey?: string
}

function transportError(message = 'websocket closed'): Error {
  return Object.assign(new Error(message), { code: 'unavailable', transport: true })
}

/**
 * One pending action, served over a socket the test can drop. `failNext`
 * makes the named method reach the node (it applies) but lose its reply.
 */
function fakeNode() {
  const calls: Call[] = []
  const lostReplies = new Set<string>()
  const receipts = new Map<string, unknown>()
  let connected = true
  let snapshotServed = false
  let state: 'pending' | 'claimed' | 'succeeded' | 'failed' | 'cancelled' = 'pending'
  let response: Record<string, unknown> | null = null
  const action = { actionId: 'a1', sessionId: 's1', version: 1, replayPolicy: 'unsafe' as const }

  const client = {
    get connected() {
      return connected
    },
    async rpc<T>(method: string, payload: Record<string, unknown> = {}, _env?: string, commandKey?: string): Promise<T> {
      if (!connected) throw transportError('not connected')
      calls.push({ method, payload, commandKey })
      if (method === 'session.hostActionsPoll') {
        if (!snapshotServed && payload.afterSequence === undefined) {
          snapshotServed = true
          return {
            cursor: '1',
            changes: [],
            outstanding: [{ ...action, state: 'pending', deadline: Date.now() + 60_000, createdAt: Date.now() }],
          } as unknown as T
        }
        await new Promise((r) => setTimeout(r, 20))
        return { cursor: '1', changes: [] } as unknown as T
      }
      const key = `${method}:${commandKey}`
      // Same key: the node replays its receipt rather than applying again.
      if (commandKey && receipts.has(key)) return receipts.get(key) as T
      let result: unknown
      if (method === 'session.claimHostAction') {
        if (state !== 'pending') throw Object.assign(new Error('host action is claimed'), { code: 'failed_precondition' })
        state = 'claimed'
        result = { ...action, version: 2, claimToken: 'tok', claimExpiresAt: Date.now() + 60_000, args: {}, toolName: 'widget_show', toolGroup: 'superone', turnId: null }
      } else if (method === 'session.respondHostAction') {
        if (state !== 'claimed') throw Object.assign(new Error(`host action is ${state}`), { code: 'failed_precondition' })
        state = payload.outcome as 'succeeded' | 'failed'
        response = payload
        result = { actionId: 'a1', state, version: 3, duplicate: false }
      } else if (method === 'session.renewHostActionClaim') {
        if (state !== 'claimed') throw Object.assign(new Error(`host action is ${state}, expected claimed`), { code: 'failed_precondition' })
        result = { actionId: 'a1', version: 2, claimExpiresAt: Date.now() + 60_000 }
      }
      if (commandKey) receipts.set(key, result)
      if (lostReplies.delete(method)) {
        connected = false
        throw transportError()
      }
      return result as T
    },
  }

  return {
    client: client as unknown as NodeRpcClient,
    calls,
    get state() {
      return state
    },
    get response() {
      return response
    },
    loseReplyOf(method: string) {
      lostReplies.add(method)
    },
    drop() {
      connected = false
    },
    reconnect() {
      connected = true
    },
    /** The node's sweep ended the action (claim expiry, deadline). */
    cancel() {
      state = 'cancelled'
    },
  }
}

async function until(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not reached')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const consumers: RemoteHostActionConsumer[] = []

afterEach(async () => {
  for (const c of consumers.splice(0)) {
    c.stop()
    await c.waitUntilStopped()
  }
})

function startConsumer(client: NodeRpcClient, executor: HostActionExecutor, claimRenewIntervalMs?: number) {
  const consumer = new RemoteHostActionConsumer({
    connectionId: 'conn',
    client,
    executor,
    pollWaitMs: 20,
    ...(claimRenewIntervalMs ? { claimRenewIntervalMs } : {}),
  })
  consumers.push(consumer)
  consumer.start()
  return consumer
}

describe('RemoteHostActionConsumer across reconnects', () => {
  it('resends a response whose reply was lost, and the action still succeeds', async () => {
    const node = fakeNode()
    let runs = 0
    node.loseReplyOf('session.respondHostAction')
    startConsumer(node.client, async () => {
      runs++
      return { outcome: 'succeeded', result: { ok: true } }
    })

    await until(() => !node.client.connected)
    node.reconnect()
    await until(() => node.calls.filter((c) => c.method === 'session.respondHostAction').length === 2)

    const responds = node.calls.filter((c) => c.method === 'session.respondHostAction')
    expect(responds[0]!.commandKey).toBe(responds[1]!.commandKey)
    expect(node.state).toBe('succeeded')
    expect(node.response?.result).toEqual({ ok: true })
    expect(runs).toBe(1)
  })

  it('waits out a dropped connection before responding', async () => {
    const node = fakeNode()
    let finish!: () => void
    const held = new Promise<void>((r) => {
      finish = r
    })
    startConsumer(node.client, async () => {
      await held
      return { outcome: 'succeeded', result: 'late' }
    })

    await until(() => node.state === 'claimed')
    node.drop()
    finish()
    await new Promise((r) => setTimeout(r, 100))
    expect(node.state).toBe('claimed')

    node.reconnect()
    await until(() => node.state === 'succeeded')
    expect(node.response?.result).toBe('late')
  })

  it('replays a claim whose reply was lost instead of giving up on the action', async () => {
    const node = fakeNode()
    const claimedTokens: string[] = []
    node.loseReplyOf('session.claimHostAction')
    startConsumer(node.client, async (claimed: ClaimHostActionResult) => {
      claimedTokens.push(claimed.claimToken)
      return { outcome: 'succeeded' }
    })

    await until(() => !node.client.connected)
    node.reconnect()
    await until(() => node.state === 'succeeded')

    const claims = node.calls.filter((c) => c.method === 'session.claimHostAction')
    expect(claims.length).toBe(2)
    expect(claims[0]!.commandKey).toBe(claims[1]!.commandKey)
    expect(claimedTokens).toEqual(['tok'])
  })

  it('renews the claim while a slow tool runs, and stops once it responds', async () => {
    const node = fakeNode()
    let finish!: () => void
    const held = new Promise<void>((r) => {
      finish = r
    })
    startConsumer(node.client, async () => {
      await held
      return { outcome: 'succeeded' }
    }, 30)

    await until(() => node.calls.filter((c) => c.method === 'session.renewHostActionClaim').length >= 2)
    expect(node.calls.find((c) => c.method === 'session.renewHostActionClaim')?.payload).toEqual({ actionId: 'a1', claimToken: 'tok' })

    finish()
    await until(() => node.state === 'succeeded')
    const renewals = node.calls.filter((c) => c.method === 'session.renewHostActionClaim').length
    await new Promise((r) => setTimeout(r, 100))
    expect(node.calls.filter((c) => c.method === 'session.renewHostActionClaim').length).toBe(renewals)
  })

  it('stops resending a response the node refuses', async () => {
    const node = fakeNode()
    const errors: unknown[] = []
    const consumer = new RemoteHostActionConsumer({
      connectionId: 'conn',
      client: node.client,
      pollWaitMs: 20,
      executor: async () => ({ outcome: 'succeeded' }),
      onError: (err) => errors.push(err),
    })
    consumers.push(consumer)
    // The node cancelled the action while the tool ran: respond is refused for good.
    const rpc = node.client.rpc.bind(node.client)
    ;(node.client as unknown as { rpc: typeof rpc }).rpc = async (method, payload, env, key) => {
      if (method === 'session.respondHostAction') {
        node.calls.push({ method, payload: payload as Record<string, unknown>, commandKey: key })
        throw Object.assign(new Error('host action already cancelled'), { code: 'failed_precondition' })
      }
      return rpc(method, payload, env, key)
    }
    consumer.start()

    await until(() => errors.some((e) => (e as { code?: string }).code === 'failed_precondition'))
    await new Promise((r) => setTimeout(r, 100))
    expect(node.calls.filter((c) => c.method === 'session.respondHostAction').length).toBe(1)
  })

  it('does not run a replayed claim for an action cancelled while disconnected', async () => {
    const node = fakeNode()
    let runs = 0
    node.loseReplyOf('session.claimHostAction')
    startConsumer(node.client, async () => {
      runs++
      return { outcome: 'succeeded' }
    })

    await until(() => !node.client.connected)
    node.cancel()
    node.reconnect()
    await until(() => node.calls.some((c) => c.method === 'session.renewHostActionClaim'))
    await new Promise((r) => setTimeout(r, 100))

    expect(runs).toBe(0)
    expect(node.calls.some((c) => c.method === 'session.respondHostAction')).toBe(false)
  })

  it('aborts a run whose claim the node no longer honours', async () => {
    const node = fakeNode()
    let aborted = false
    startConsumer(node.client, (_claimed, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => {
        aborted = true
        resolve({ outcome: 'succeeded' })
      }, { once: true })
    }), 30)

    await until(() => node.state === 'claimed')
    node.cancel()
    await until(() => aborted)
    await new Promise((r) => setTimeout(r, 100))
    expect(node.calls.some((c) => c.method === 'session.respondHostAction')).toBe(false)
  })
})
