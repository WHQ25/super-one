import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'
import type { AgentEvent } from '@superone/shared/agent-types'
import { createAcpRuntime } from '../../acp/acp-runtime'
import { AcpBackend, setAcpRuntimeFactory } from './acp-backend'
import type { BackendStartOptions } from '../types'

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../../agent/resolve-cli', () => ({
  getNodeRuntime: () => ({ executable: '/fake/node', env: {} }),
}))

vi.mock('../../mcp-config-service', () => ({
  listMcpConfigs: vi.fn(() => []),
}))

function startOpts(): BackendStartOptions {
  return {
    sessionId: 'sess-1',
    projectPath: '/tmp/proj',
    cwd: '/tmp/proj',
    config: { agentId: 'custom', command: 'unused' },
    permissionMode: 'default',
    abortController: new AbortController(),
  }
}

describe('AcpBackend auto-wake integration', () => {
  afterEach(() => {
    setAcpRuntimeFactory(null)
  })

  it('keeps the new user prompt streaming while completing an open auto-wake', async () => {
    let agentNotifyClient: {
      notify: (method: string, params: unknown) => Promise<void>
    } | null = null
    let promptCount = 0
    let releaseSecondPrompt!: () => void
    const secondPromptGate = new Promise<void>((resolve) => {
      releaseSecondPrompt = resolve
    })

    const agentApp = agent({ name: 'auto-wake-handoff-agent' })
      .onRequest(methods.agent.initialize, async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, async () => ({ sessionId: 'sess-auto-wake' }))
      .onRequest(methods.agent.session.prompt, async (ctx) => {
        agentNotifyClient = ctx.client
        promptCount += 1
        if (promptCount === 2) await secondPromptGate
        return { stopReason: 'end_turn' as const }
      })
      .onNotification(methods.agent.session.cancel, async () => {})
      .onRequest(methods.agent.session.setMode, async () => ({}))

    const clientToAgent = new TransformStream<Uint8Array>()
    const agentToClient = new TransformStream<Uint8Array>()
    agentApp.connect(ndJsonStream(agentToClient.writable, clientToAgent.readable))
    const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable)
    const dispose = () => {
      try {
        if (!clientToAgent.writable.locked) void clientToAgent.writable.close().catch(() => undefined)
      } catch { /* ignore */ }
      try {
        if (!agentToClient.writable.locked) void agentToClient.writable.close().catch(() => undefined)
      } catch { /* ignore */ }
    }

    setAcpRuntimeFactory(async (opts) => createAcpRuntime({
      ...opts,
      streamFactory: async () => ({ stream: clientStream, dispose }),
    }))

    const backend = new AcpBackend()
    const events: AgentEvent[] = []
    backend.onEvent((event) => events.push(event))
    await backend.start(startOpts())
    await backend.send({ content: 'first', assistantMessageId: 'msg-1' })

    expect(agentNotifyClient).toBeTruthy()
    await agentNotifyClient!.notify(methods.client.session.update, {
      sessionId: 'sess-auto-wake',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'wake-open',
        content: { type: 'text', text: 'background work finished' },
      },
    })
    await vi.waitFor(() => {
      expect(events.some((event) => (
        event.type === 'message_start' && event.message.id.startsWith('acp_wake_')
      ))).toBe(true)
    })
    const wakeStart = events.find((event) => (
      event.type === 'message_start' && event.message.id.startsWith('acp_wake_')
    ))
    const wakeId = wakeStart?.type === 'message_start' ? wakeStart.message.id : ''

    const handoffStart = events.length
    const secondSend = backend.send({ content: 'second', assistantMessageId: 'msg-2' })
    let handoffEvents: AgentEvent[] = []
    try {
      await vi.waitFor(() => expect(promptCount).toBe(2))
      handoffEvents = events.slice(handoffStart)
    } finally {
      releaseSecondPrompt()
      await secondSend
      await backend.close()
    }

    expect(handoffEvents.some((event) => (
      event.type === 'message_complete' && event.messageId === wakeId
    ))).toBe(true)
    expect(handoffEvents
      .filter((event): event is Extract<AgentEvent, { type: 'status_change' }> => event.type === 'status_change')
      .map((event) => event.status))
      .toEqual(['streaming'])
  })
})
