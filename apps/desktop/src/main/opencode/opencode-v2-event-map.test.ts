import { describe, expect, it } from 'vitest'
import {
  mapOpenCodeV2FormRequest,
  openCodeV2EventSessionId,
  openCodeV2FormAnswer,
  OpenCodeV2TurnTranslator,
  type OpenCodeV2TurnAction,
} from './opencode-v2-event-map'
import type { OpenCodeV2Event, OpenCodeV2Form } from './opencode-v2-types'

const S = 'ses_1'
const A = 'msg_assistant'

function ev(type: string, data: Record<string, unknown>, created?: number): OpenCodeV2Event {
  return { id: `evt_${type}`, type, data: { sessionID: S, ...data }, ...(created ? { created } : {}) } as OpenCodeV2Event
}

function run(events: OpenCodeV2Event[], messageId: string | null = 'local'): OpenCodeV2TurnAction[] {
  const translator = new OpenCodeV2TurnTranslator({ contextWindow: (model) => (model === 'opencode/m1' ? 1000 : undefined) })
  return events.flatMap((event) => translator.apply(event, messageId))
}

function agentEvents(actions: OpenCodeV2TurnAction[]) {
  return actions.flatMap((action) => action.type === 'agent' ? [action.event] : [])
}

const questionForm: OpenCodeV2Form = {
  id: 'frm_1',
  sessionID: S,
  title: 'Questions',
  fields: [
    {
      key: 'q0',
      title: 'Choice',
      description: 'Choose one option.',
      type: 'string',
      options: [{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B', description: 'B' }],
    },
    { key: 'q1', title: 'Tags', type: 'multiselect', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] },
    { key: 'q2', title: 'Confirm', type: 'boolean', required: true },
    { key: 'secret', type: 'string', hidden: true },
  ],
}

describe('OpenCodeV2TurnTranslator', () => {
  it('maps a tool turn to chat deltas, usage metadata and completion', () => {
    const actions = run([
      ev('session.inbox.enqueued', { inboxID: 'msg_user', item: { type: 'user' } }),
      ev('session.execution.started', {}),
      ev('session.inbox.delivered', { inboxID: 'msg_user' }),
      ev('session.step.started', { assistantMessageID: A, agent: 'build', model: { id: 'm1', providerID: 'opencode' } }),
      ev('session.reasoning.started', { assistantMessageID: A, ordinal: 0 }, 100),
      ev('session.reasoning.delta', { assistantMessageID: A, ordinal: 0, delta: 'Think' }),
      ev('session.reasoning.ended', { assistantMessageID: A, ordinal: 0, text: 'Think more' }, 200),
      ev('session.tool.input.started', { assistantMessageID: A, id: 'call_1', name: 'shell' }, 300),
      ev('session.tool.called', { assistantMessageID: A, id: 'call_1', input: { command: 'echo hi' } }),
      ev('session.tool.success', { assistantMessageID: A, id: 'call_1', content: [{ type: 'text', text: 'hi\n' }] }),
      ev('session.text.delta', { assistantMessageID: A, ordinal: 0, delta: 'Do' }),
      ev('session.text.ended', { assistantMessageID: A, ordinal: 0, text: 'Done' }),
      ev('session.step.ended', {
        assistantMessageID: A,
        finish: 'stop',
        cost: 0.5,
        tokens: { input: 10, output: 5, reasoning: 1, cache: { read: 20, write: 2 } },
      }),
      ev('session.execution.succeeded', {}),
    ])

    expect(agentEvents(actions)).toEqual([
      { type: 'checkpoint_captured', messageId: 'local', checkpointId: 'msg_user', resumePointId: 'msg_user' },
      { type: 'content_delta', messageId: 'local', delta: { type: 'thinking', thinking: 'Think', startedAt: 100 } },
      { type: 'content_delta', messageId: 'local', delta: { type: 'thinking', thinking: ' more', startedAt: 100, endedAt: 200 } },
      {
        type: 'content_delta',
        messageId: 'local',
        delta: { type: 'tool_use', toolName: 'Bash', toolUseId: 'call_1', input: '{}', status: 'streaming', startedAt: 300 },
      },
      {
        type: 'content_delta',
        messageId: 'local',
        delta: { type: 'tool_use', toolName: 'Bash', toolUseId: 'call_1', input: '{"command":"echo hi"}', status: 'streaming' },
      },
      {
        type: 'content_delta',
        messageId: 'local',
        delta: { type: 'tool_use', toolName: 'Bash', toolUseId: 'call_1', input: '{"command":"echo hi"}', status: 'complete' },
      },
      { type: 'content_delta', messageId: 'local', delta: { type: 'tool_result', toolUseId: 'call_1', summary: 'hi\n', isError: false } },
      { type: 'content_delta', messageId: 'local', delta: { type: 'text', text: 'Do' } },
      { type: 'content_delta', messageId: 'local', delta: { type: 'text', text: 'ne' } },
      {
        type: 'message_usage',
        messageId: 'local',
        inputTokens: 32,
        outputTokens: 6,
        contextTokens: 38,
        contextWindow: 1000,
        costUsd: 0.5,
      },
    ])
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'step_ended',
      contextTokens: 38,
      metadata: expect.objectContaining({ model: 'opencode/m1', agent: 'build', stopReason: 'stop', forkAnchorId: A }),
    }))
    expect(actions.at(-1)).toEqual({ type: 'complete', interrupted: false })
  })

  it('ends a fully streamed thinking block, but never opens one after later content', () => {
    const step = ev('session.step.started', { assistantMessageID: A, agent: 'build', model: { id: 'm1', providerID: 'opencode' } })
    const streamed = run([
      step,
      ev('session.reasoning.started', { assistantMessageID: A, ordinal: 0 }, 100),
      ev('session.reasoning.delta', { assistantMessageID: A, ordinal: 0, delta: 'Think' }),
      ev('session.reasoning.ended', { assistantMessageID: A, ordinal: 0, text: 'Think' }, 200),
    ])
    expect(agentEvents(streamed).at(-1)).toEqual({
      type: 'content_delta',
      messageId: 'local',
      delta: { type: 'thinking', thinking: '', startedAt: 100, endedAt: 200 },
    })

    const afterText = run([
      step,
      ev('session.reasoning.delta', { assistantMessageID: A, ordinal: 0, delta: 'Think' }),
      ev('session.text.delta', { assistantMessageID: A, ordinal: 0, delta: 'Answer' }),
      ev('session.reasoning.ended', { assistantMessageID: A, ordinal: 0, text: 'Think' }, 200),
    ])
    expect(agentEvents(afterText).at(-1)).toEqual({ type: 'content_delta', messageId: 'local', delta: { type: 'text', text: 'Answer' } })
  })

  it('settles only on the execution that delivered this turn’s inbox item', () => {
    const actions = run([
      // Clearing a revert runs its own execution, which can land after the reset.
      ev('session.execution.succeeded', {}),
      ev('session.execution.started', {}),
      ev('session.inbox.enqueued', { inboxID: 'msg_next', item: { type: 'user' } }),
      ev('session.execution.succeeded', {}),
      ev('session.execution.started', {}),
      ev('session.inbox.delivered', { inboxID: 'msg_next' }),
      ev('session.execution.interrupted', { reason: 'user' }),
    ])
    expect(actions.filter((action) => action.type !== 'agent')).toEqual([{ type: 'complete', interrupted: true }])
  })

  it('settles a manual compaction through its execution', () => {
    const actions = run([
      ev('session.inbox.enqueued', { inboxID: 'msg_compact', item: { type: 'compaction' } }),
      ev('session.execution.started', {}),
      ev('session.inbox.delivered', { inboxID: 'msg_compact' }),
      ev('session.compaction.started', { reason: 'manual' }),
      ev('session.compaction.ended', { reason: 'manual' }),
      ev('session.execution.succeeded', {}),
    ])
    expect(actions.map((action) => action.type)).toEqual(['compaction_started', 'compacted', 'complete'])
  })

  it('fails the turn with the execution error', () => {
    const actions = run([
      ev('session.inbox.enqueued', { inboxID: 'msg_user', item: { type: 'user' } }),
      ev('session.execution.started', {}),
      ev('session.inbox.delivered', { inboxID: 'msg_user' }),
      ev('session.step.started', { assistantMessageID: A, agent: 'build', model: { id: 'm1', providerID: 'opencode' } }),
      ev('session.tool.input.started', { assistantMessageID: A, id: 'call_2', name: 'read' }),
      ev('session.tool.failed', { assistantMessageID: A, id: 'call_2', error: { type: 'fs', message: 'missing file' } }),
      ev('session.execution.failed', { error: { type: 'provider', message: 'Upstream unavailable' } }),
    ])
    expect(agentEvents(actions)).toContainEqual({
      type: 'content_delta',
      messageId: 'local',
      delta: { type: 'tool_result', toolUseId: 'call_2', summary: 'missing file', isError: true },
    })
    expect(actions.at(-1)).toEqual({ type: 'fail', error: 'Upstream unavailable' })
  })

  it('completes a shell-only turn when the shell ends', () => {
    const shell = { id: 'sh_1', command: 'ls', status: 'exited' }
    const actions = run([
      ev('session.shell.started', { shell: { ...shell, status: 'running' } }),
      ev('session.shell.ended', { shell, output: { output: 'a.txt\n' } }),
    ])
    expect(agentEvents(actions).at(-1)).toEqual({
      type: 'content_delta',
      messageId: 'local',
      delta: { type: 'tool_result', toolUseId: 'sh_1', summary: 'a.txt\n', isError: false },
    })
    expect(actions.at(-1)).toEqual({ type: 'complete', interrupted: false })
  })

  it('drops the end of a shell started before the turn', () => {
    const translator = new OpenCodeV2TurnTranslator({ contextWindow: () => undefined })
    const shell = { id: 'sh_old', command: 'sleep 60', status: 'killed' }
    translator.apply(ev('session.shell.started', { shell: { ...shell, status: 'running' } }), 'm1')
    translator.reset()
    expect(translator.apply(ev('session.shell.ended', { shell, output: { output: '' } }), 'm2')).toEqual([])
  })

  it('carries the called tool input on its permission request', () => {
    const actions = run([
      ev('session.step.started', { assistantMessageID: A, agent: 'build', model: { id: 'm1', providerID: 'opencode' } }),
      ev('session.tool.called', { assistantMessageID: A, id: 'call_t', input: { command: 'ls' } }),
      {
        id: 'evt_perm',
        type: 'permission.asked',
        data: {
          id: 'per_1',
          sessionID: S,
          action: 'superone_terminal_tabs',
          resources: ['*'],
          save: ['*'],
          source: { type: 'tool', messageID: A, id: 'call_t' },
        },
      },
      ev('permission.replied', { requestID: 'per_1', reply: 'reject' }),
    ])
    expect(actions).toContainEqual({
      type: 'permission',
      permission: 'superone_terminal_tabs',
      toolInput: { command: 'ls' },
      request: expect.objectContaining({ requestId: 'per_1', toolName: 'superone_terminal_tabs', toolUseId: 'call_t' }),
    })
    expect(actions.at(-1)).toEqual({ type: 'permission_resolved', requestId: 'per_1', approved: false })
  })

  it('drops late content from a step that started before the turn', () => {
    const translator = new OpenCodeV2TurnTranslator({ contextWindow: () => undefined })
    translator.apply(ev('session.step.started', { assistantMessageID: 'msg_old', agent: 'build', model: { id: 'm1', providerID: 'opencode' } }), 'm3')
    translator.reset()
    expect(translator.apply(ev('session.text.ended', { assistantMessageID: 'msg_old', ordinal: 0, text: 'late tail' }), 'm4')).toEqual([])
    expect(translator.apply(ev('session.reasoning.ended', { assistantMessageID: 'msg_old', ordinal: 0, text: 'late' }), 'm4')).toEqual([])
  })

  it('routes interactions and compaction outside a turn but drops chat content', () => {
    const actions = run([
      { id: 'evt_form', type: 'form.created', data: { form: questionForm } },
      ev('session.compaction.started', { reason: 'auto' }),
      ev('session.compaction.ended', { reason: 'auto' }),
      ev('session.text.delta', { assistantMessageID: A, ordinal: 0, delta: 'late' }),
    ], null)
    expect(actions.map((action) => action.type)).toEqual(['question', 'compaction_started', 'compacted'])
  })
})

describe('OpenCode 2 forms', () => {
  it('maps visible fields to questions', () => {
    expect(mapOpenCodeV2FormRequest(questionForm)).toEqual({
      requestId: 'frm_1',
      questions: [
        {
          question: 'Choose one option.',
          header: 'Choice',
          options: [{ label: 'Option A', description: '' }, { label: 'Option B', description: 'B' }],
          multiSelect: false,
        },
        { question: 'Tags', header: 'Tags', options: [{ label: 'X', description: '' }, { label: 'Y', description: '' }], multiSelect: true },
        { question: 'Confirm', header: 'Confirm', options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }], multiSelect: false },
      ],
    })
  })

  it('answers with option values, typed values and custom text', () => {
    expect(openCodeV2FormAnswer(questionForm, [['Option B'], ['X', 'Y'], ['Yes']])).toEqual({ q0: 'b', q1: ['x', 'y'], q2: true })
    expect(openCodeV2FormAnswer(questionForm, [['something else'], [], []])).toEqual({ q0: 'something else', q2: false })
  })

  it('reads the session id nested in form events', () => {
    expect(openCodeV2EventSessionId({ id: 'e', type: 'form.created', data: { form: questionForm } })).toBe(S)
    expect(openCodeV2EventSessionId(ev('session.execution.started', {}))).toBe(S)
  })
})
