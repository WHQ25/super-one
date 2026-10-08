import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendDeliveryHarness } from '@superone/runtime/session/send-delivery.test-support'

const mocks = vi.hoisted(() => {
  const state = { sessionFails: false, promptFails: false, prompts: 0 }
  const reply = () => [
    {
      kind: 'session_update',
      notification: { sessionId: 'acp-1' },
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done' } },
    },
    { kind: 'stop', stopReason: 'end_turn' },
  ]
  let updates: unknown[] = []
  const active = {
    sessionId: 'acp-1',
    prompt: async () => {
      state.prompts += 1
      // session/prompt went out; the agent process died before answering.
      if (state.promptFails) throw new Error('ACP connection closed')
      updates = reply()
      return { stopReason: 'end_turn' }
    },
    nextUpdate: () => new Promise((resolve) => {
      const poll = () => (updates.length ? resolve(updates.shift()) : setTimeout(poll, 5))
      poll()
    }),
    dispose: () => {},
  }
  const connection = {
    agent: {
      request: async () => ({}),
      buildSession: () => ({
        start: async () => {
          if (state.sessionFails) throw new Error('session/new failed: agent not authenticated')
          return active
        },
      }),
    },
    close: () => {},
  }
  const app = {
    onRequest: () => app,
    onNotification: () => app,
    connect: () => connection,
  }
  return { state, app }
})

vi.mock('@agentclientprotocol/sdk', () => ({
  client: () => mocks.app,
  methods: {
    client: { session: { requestPermission: 'session/request_permission' } },
    agent: { initialize: 'initialize', authenticate: 'authenticate' },
  },
  PROTOCOL_VERSION: 1,
}))
vi.mock('./process', () => ({ spawnAcpProcess: () => ({ stream: {}, kill: async () => undefined }) }))

import { createAcpAgentTurnRunner } from './run-turn'

describe('ACP runner input delivery', () => {
  beforeEach(() => Object.assign(mocks.state, { sessionFails: false, promptFails: false, prompts: 0 }))
  const harness = () => sendDeliveryHarness(
    createAcpAgentTurnRunner({ launch: { command: 'agent' }, resolveProjectPath: () => '/tmp' }), 'acp', '/tmp')

  it('keeps a message whose session never opened retryable, and runs its resend', async () => {
    const h = harness()
    mocks.state.sessionFails = true
    const failed = await h.send('u1')
    expect(mocks.state.prompts).toBe(0)
    expect(failed.status).toBe('idle')
    expect(h.failureOf(failed, 'u1')?.error).toMatch(/session\/new failed/)

    mocks.state.sessionFails = false
    const answered = await h.send('u1')
    expect(mocks.state.prompts).toBe(1)
    expect(h.failureOf(answered, 'u1')).toBeUndefined()
    expect(h.lastAssistantText(answered)).toBe('done')
  })

  it('holds a message whose prompt was sent before the agent failed', async () => {
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
