import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../agent-types'
import { SESSION_DURABLE_EVENT, streamingEventKey } from './session-events'

const tier = (event: AgentEvent) => streamingEventKey(SESSION_DURABLE_EVENT.agentEvent, { event })
const call = { type: 'tool_use' as const, toolName: 'Bash', toolUseId: 'c', input: '{"command":"bun test"}', status: 'streaming' as const }

describe('the streaming tier of content deltas', () => {
  it('streams text and running command output until the message commits', () => {
    expect(tier({ type: 'content_delta', messageId: 'm', delta: { type: 'text', text: 'Hi' } })).toEqual({ messageId: 'm' })
    expect(tier({ type: 'content_delta', messageId: 'm', delta: { ...call, outputDelta: 'passed' } })).toEqual({ messageId: 'm' })
  })

  it('keeps a tool call and its result durable', () => {
    expect(tier({ type: 'content_delta', messageId: 'm', delta: call })).toBeNull()
    expect(tier({ type: 'content_delta', messageId: 'm', delta: { type: 'tool_result', toolUseId: 'c', summary: 'ok' } })).toBeNull()
  })
})
