import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendDeliveryHarness } from '@superone/runtime/session/send-delivery.test-support'

const mocks = vi.hoisted(() => {
  const state = { subscribeFails: false, promptFails: false, subscriptions: 0, prompts: 0 }
  const reply = async function* () {
    yield {
      type: 'message.updated',
      properties: { sessionID: 'oc-1', info: {
        id: 'a1', role: 'assistant', providerID: 'openai', modelID: 'gpt-5.4', agent: 'build', cost: 0, finish: null,
        tokens: { input: 1, output: 1, reasoning: 0, total: 2, cache: { read: 0, write: 0 } },
      } },
    }
    yield {
      type: 'message.part.updated',
      properties: { sessionID: 'oc-1', part: { id: 'p1', messageID: 'a1', type: 'text', text: 'done', time: { start: 1 } } },
    }
    yield { type: 'session.status', properties: { sessionID: 'oc-1', status: { type: 'idle' } } }
  }
  const client = {
    session: {
      create: async () => ({ data: { id: 'oc-1' } }),
      promptAsync: async () => {
        state.prompts += 1
        // The request went out; only its response is lost.
        if (state.promptFails) throw new Error('fetch failed: socket hang up')
      },
    },
    mcp: { add: async () => undefined },
    event: {
      subscribe: async () => {
        state.subscriptions += 1
        if (state.subscribeFails) throw new Error('environment is not connected')
        return { stream: reply() }
      },
    },
  }
  return { state, client }
})

vi.mock('@opencode-ai/sdk/v2', () => ({ createOpencodeClient: () => mocks.client }))
vi.mock('./server', () => ({
  startOpenCodeServer: async () => ({ url: 'http://127.0.0.1:9999', exited: null, close: async () => undefined }),
}))

import { createOpenCodeAppServerTurnRunner } from './run-turn'

describe('OpenCode runner input delivery', () => {
  beforeEach(() => Object.assign(mocks.state, { subscribeFails: false, promptFails: false, subscriptions: 0, prompts: 0 }))
  const harness = () => sendDeliveryHarness(createOpenCodeAppServerTurnRunner(() => '/tmp'), 'opencode', '/tmp')

  it('keeps a message whose event subscription failed retryable, and runs its resend', async () => {
    const h = harness()
    mocks.state.subscribeFails = true
    const failed = await h.send('u1')
    expect(mocks.state).toMatchObject({ subscriptions: 1, prompts: 0 })
    expect(failed.status).toBe('idle')
    expect(h.failureOf(failed, 'u1')).toEqual({ error: 'environment is not connected' })

    mocks.state.subscribeFails = false
    const answered = await h.send('u1')
    expect(mocks.state.prompts).toBe(1)
    expect(h.failureOf(answered, 'u1')).toBeUndefined()
    expect(h.lastAssistantText(answered)).toBe('done')
  })

  it('holds a message whose prompt request may have reached OpenCode', async () => {
    const h = harness()
    mocks.state.promptFails = true
    const failed = await h.send('u1')
    expect(failed.status).toBe('error')
    expect(h.failureOf(failed, 'u1')).toBeUndefined()

    mocks.state.promptFails = false
    await h.send('u1')
    expect(mocks.state.prompts).toBe(1)
  })
})
