import { describe, expect, it } from 'vitest'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import type { AgentEvent } from '@superone/shared/agent-types'
import {
  createAcpAgentEventMapper,
  mapSessionUpdate,
} from './agent-event-mapper'
import { XAI_SESSION_NOTIFICATION } from './xai-state'

function update(value: Record<string, unknown>): SessionUpdate {
  return value as unknown as SessionUpdate
}

describe('ACP AgentEvent mapper', () => {
  it('projects text, thought, tools, usage, and lifecycle without legacy deltas', () => {
    const events: AgentEvent[] = []
    const mapper = createAcpAgentEventMapper({
      messageId: 'message-1',
      emit: (event) => events.push(event),
      now: () => 1_000,
    })

    mapper.start('acp-session-1')
    expect(mapper.apply(update({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'native-1',
      content: { type: 'text', text: 'hello' },
    })).textDelta).toBe('hello')
    mapper.apply(update({
      sessionUpdate: 'agent_thought_chunk',
      messageId: 'native-1',
      content: { type: 'text', text: 'thinking' },
    }))
    mapper.apply(update({
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      kind: 'execute',
      title: 'Run command',
      status: 'in_progress',
      rawInput: { command: 'pwd' },
      content: [],
    }))
    mapper.apply(update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-1',
      status: 'completed',
      rawOutput: { stdout: '/tmp/project' },
      content: [],
    }))
    mapper.apply(update({
      sessionUpdate: 'usage_update',
      used: 120,
      size: 1_000,
      cost: { amount: 0.05, currency: 'USD' },
    }))
    mapper.complete('end_turn')

    expect(events.map((event) => event.type)).toEqual([
      'message_start',
      'status_change',
      'provider_session_id',
      'content_delta',
      'content_delta',
      'content_delta',
      'content_delta',
      'message_usage',
      'message_complete',
      'status_change',
    ])
    const blocks = events
      .filter((event) => event.type === 'content_delta')
      .map((event) => event.delta)
    expect(blocks).toContainEqual(expect.objectContaining({ type: 'thinking', thinking: 'thinking' }))
    expect(blocks).toContainEqual(expect.objectContaining({ type: 'tool_use', toolName: 'Bash', toolUseId: 'tool-1' }))
    expect(blocks).toContainEqual(expect.objectContaining({ type: 'tool_result', toolUseId: 'tool-1', summary: '/tmp/project' }))
  })

  it('preserves Grok config and command extensions', () => {
    expect(mapSessionUpdate(update({
      sessionUpdate: 'config_option_update',
      configOptions: [{
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'grok-code',
        options: [{ value: 'grok-code', name: 'Grok Code' }],
      }],
    }), { messageId: 'message-1' })).toContainEqual(expect.objectContaining({
      type: 'acp_models',
      selectedModelId: 'grok-code',
    }))

    expect(mapSessionUpdate(update({
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        { name: 'review', description: 'Review changes', input: { hint: '[path]' } },
        { name: 'always-approve', description: 'hidden' },
      ],
    }), { messageId: 'message-1' })).toEqual([{
      type: 'acp_commands',
      commands: [{
        name: 'review',
        description: 'Review changes',
        argumentHint: '[path]',
        isSkill: false,
      }],
    }])
  })

  it('fills argumentHint from skill path when input.hint is missing (arguments:)', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'acp-pkg-arg-hint-'))
    const skillPath = join(dir, 'SKILL.md')
    try {
      writeFileSync(
        skillPath,
        '---\nname: release\narguments: "[channel] [bump]"\n---\n',
        'utf8',
      )
      expect(mapSessionUpdate(update({
        sessionUpdate: 'available_commands_update',
        availableCommands: [
          { name: 'release', description: 'Ship', input: null, _meta: { path: skillPath } },
        ],
      }), { messageId: 'message-1' })).toEqual([{
        type: 'acp_commands',
        commands: [{
          name: 'release',
          description: 'Ship',
          argumentHint: '[channel] [bump]',
          isSkill: true,
        }],
      }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('shares correlation and context state across standard and xAI updates', () => {
    const events: AgentEvent[] = []
    const mapper = createAcpAgentEventMapper({
      messageId: 'message-1',
      emit: (event) => events.push(event),
    })

    mapper.start('acp-session-1')
    mapper.apply(update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'workflow-tool',
      status: 'completed',
      rawOutput: { run_id: 'workflow-1' },
      content: [],
    }), { totalTokens: 42_000 })
    mapper.applyXaiNotification(XAI_SESSION_NOTIFICATION, {
      sessionId: 'acp-session-1',
      update: {
        sessionUpdate: 'workflow_updated',
        run_id: 'workflow-1',
        revision: 1,
        name: 'review',
        objective: 'Review changes',
        status: 'active',
      },
    })

    expect(events).toContainEqual(expect.objectContaining({
      type: 'message_usage',
      messageId: 'message-1',
      contextTokens: 42_000,
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'task_started',
      taskId: 'workflow-1',
      toolUseId: 'workflow-tool',
    }))
  })
})
