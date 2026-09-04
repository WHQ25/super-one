import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { applyEventToSession } from './reducer'
import { createDefaultChatCoreSession } from './defaults'
import { createStreamingToolInputStore, type ChatCorePorts } from './ports'
import { droppedRecordings, recordedScenarios } from './fixtures/recorded.generated'
import type { ChatCoreSession } from './types'

const REMOTE_OMITTED = new Set([
  'files_persisted',
  'elicitation_complete',
  'tool_input_delta',
  'subagent_usage',
  'checkpoint_captured',
  'hook_started',
  'hook_complete',
  'hook_progress',
  'slash_command_output',
  'stream_message_start',
  'stream_message_stop',
])

function reduce(events: AgentEvent[]): ChatCoreSession {
  let id = 0
  const ports: ChatCorePorts = {
    now: () => 1_700_000_000_000,
    id: (prefix) => `${prefix}${++id}`,
    streaming: createStreamingToolInputStore(),
  }
  const state = createDefaultChatCoreSession()
  for (const event of events) Object.assign(state, applyEventToSession(state, event, ports))
  return state
}

function projection(state: ChatCoreSession) {
  return {
    messages: state.messages,
    status: state.status,
    awaitingAssistantReply: state.awaitingAssistantReply,
    sessionProvider: state.sessionProvider,
    selectedModel: state.selectedModel,
    permissionMode: state.permissionMode,
    pendingPermissions: state.pendingPermissions,
    pendingQuestion: state.pendingQuestion,
    pendingPlanApproval: state.pendingPlanApproval,
    todos: state.todos,
    taskProgress: state.taskProgress,
    promptSuggestion: state.promptSuggestion,
    rateLimitInfo: state.rateLimitInfo,
    contextTokens: state.contextTokens,
    totalCostUsd: state.totalCostUsd,
  }
}

describe('recorded remote.out reducer oracle (WP-14)', () => {
  for (const scenario of recordedScenarios) {
    it(`${scenario.recording}:${scenario.messageId}`, () => {
      expect(projection(reduce(scenario.events))).toMatchSnapshot()
    })
  }

  it('contains no Desktop-omitted remote event families', () => {
    const found = recordedScenarios.flatMap((scenario) => scenario.events)
      .filter((event) => REMOTE_OMITTED.has(event.type))
      .map((event) => event.type)
    expect(found).toEqual([])
  })

  it('records the empty background-agent database as an explicit drop', () => {
    expect(droppedRecordings).toContainEqual({
      recording: 'bg-agent-history',
      reason: 'recording database has no events schema',
    })
  })
})

describe('remote batch field contracts', () => {
  it('uses the reducer clock for restored queued messages', () => {
    const state = reduce([{
      type: 'queued_messages_restored',
      messages: [{ clientMessageId: 'queued-1', content: 'continue' }],
    }])

    expect(state.queuedMessages[0]?.createdAt).toBe('2023-11-14T22:13:20.000Z')
  })

  it('reduces a mixed-seq multi-event envelope without conflating event seq', () => {
    const events = [
      { type: 'message_start', message: { id: 'm', role: 'assistant', status: 'streaming', content: [], createdAt: '2026-01-01T00:00:00.000Z', providerId: 'claude' }, seq: 40 },
      { type: 'content_delta', messageId: 'm', delta: { type: 'thinking', thinking: 'reason ' } },
      { type: 'content_delta', messageId: 'm', delta: { type: 'thinking', thinking: 'continued' }, seq: 99 },
      { type: 'content_delta', messageId: 'm', delta: { type: 'text', text: 'answer' } },
    ] as unknown as AgentEvent[]
    const state = reduce(events)
    expect(state.messages[0]?.content).toEqual([
      expect.objectContaining({ type: 'thinking', thinking: 'reason continued' }),
      expect.objectContaining({ type: 'text', text: 'answer' }),
    ])
  })

  it('accepts Desktop-rebuilt text/thinking deltas with their canonical fields', () => {
    const state = reduce([
      { type: 'message_start', message: { id: 'm', role: 'assistant', status: 'streaming', content: [], createdAt: '2026-01-01T00:00:00.000Z', providerId: 'claude' } },
      { type: 'content_delta', messageId: 'm', delta: { type: 'thinking', thinking: '', parentToolUseId: null } },
      { type: 'content_delta', messageId: 'm', delta: { type: 'thinking', thinking: 'desktop thought', parentToolUseId: null } },
      { type: 'content_delta', messageId: 'm', delta: { type: 'text', text: 'desktop answer', parentToolUseId: null } },
    ] as AgentEvent[])
    expect(state.messages[0]?.content).toEqual([
      expect.objectContaining({ type: 'thinking', thinking: 'desktop thought' }),
      expect.objectContaining({ type: 'text', text: 'desktop answer' }),
    ])
  })
})
