import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { OpenCodeRuntime, OpenCodeRuntimeEvent, OpenCodeRuntimeOptions } from '../../opencode/opencode-runtime'

vi.mock('../../logger', () => ({ default: { debug: vi.fn(), warn: vi.fn() } }))

import { OpenCodeBackend, setOpenCodeRuntimeFactory } from './opencode-backend'
import type { BackendStartOptions } from '../types'

function startOptions(overrides: Partial<BackendStartOptions> = {}): BackendStartOptions {
  return {
    sessionId: 'superone-session',
    projectPath: '/project',
    cwd: '/project',
    config: {},
    permissionMode: 'default',
    abortController: new AbortController(),
    ...overrides,
  }
}

describe('OpenCodeBackend', () => {
  let route: (event: OpenCodeRuntimeEvent) => void
  let runtime: OpenCodeRuntime
  let prompt: ReturnType<typeof vi.fn>
  let setPermissionMode: ReturnType<typeof vi.fn>
  let permissionReply: ReturnType<typeof vi.fn>
  let questionReply: ReturnType<typeof vi.fn>
  let questionReject: ReturnType<typeof vi.fn>
  let close: ReturnType<typeof vi.fn>

  beforeEach(() => {
    route = () => undefined
    prompt = vi.fn(async () => undefined)
    setPermissionMode = vi.fn(async () => undefined)
    permissionReply = vi.fn(async () => undefined)
    questionReply = vi.fn(async () => undefined)
    questionReject = vi.fn(async () => undefined)
    close = vi.fn(async () => undefined)
    runtime = {
      sessionId: 'oc-session',
      models: [],
      agents: [],
      prompt,
      setModel: vi.fn(async () => undefined),
      setPermissionMode,
      cancel: vi.fn(async () => undefined),
      permissionReply,
      questionReply,
      questionReject,
      close,
    }
    setOpenCodeRuntimeFactory(async (opts: OpenCodeRuntimeOptions) => {
      route = opts.onEvent
      return runtime
    })
  })

  afterEach(() => {
    setOpenCodeRuntimeFactory(null)
  })

  it('maps assistant text, reasoning, tools and terminal metadata', async () => {
    const backend = new OpenCodeBackend()
    const events: AgentEvent[] = []
    backend.onEvent((event) => events.push(event))
    await backend.start(startOptions())

    const send = backend.send({ content: 'hello', model: 'openai/gpt-5', assistantMessageId: 'assistant-local' })
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())

    route({
      id: 'event-user-message',
      type: 'message.updated',
      properties: {
        sessionID: 'oc-session',
        info: {
          id: 'user-message',
          sessionID: 'oc-session',
          role: 'user',
          time: { created: 1 },
          agent: 'build',
          model: { providerID: 'openai', modelID: 'gpt-5' },
        },
      },
    } as OpenCodeRuntimeEvent)
    route({
      id: 'event-user-part',
      type: 'message.part.updated',
      properties: {
        sessionID: 'oc-session',
        part: { id: 'user-part', sessionID: 'oc-session', messageID: 'user-message', type: 'text', text: 'hello' },
        time: 1,
      },
    } as OpenCodeRuntimeEvent)
    route({
      id: 'event-assistant-message',
      type: 'message.updated',
      properties: {
        sessionID: 'oc-session',
        info: {
          id: 'assistant-message',
          sessionID: 'oc-session',
          role: 'assistant',
          time: { created: 2, completed: 8 },
          parentID: 'user-message',
          modelID: 'gpt-5',
          providerID: 'openai',
          mode: 'build',
          agent: 'build',
          path: { cwd: '/project', root: '/project' },
          cost: 0.01,
          tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 }, total: 20 },
          finish: 'stop',
        },
      },
    } as OpenCodeRuntimeEvent)
    route({
      id: 'event-reasoning',
      type: 'message.part.updated',
      properties: {
        sessionID: 'oc-session',
        part: {
          id: 'reasoning-part',
          sessionID: 'oc-session',
          messageID: 'assistant-message',
          type: 'reasoning',
          text: 'Think',
          time: { start: 3 },
        },
        time: 3,
      },
    } as OpenCodeRuntimeEvent)
    route({
      id: 'event-text',
      type: 'message.part.updated',
      properties: {
        sessionID: 'oc-session',
        part: {
          id: 'text-part',
          sessionID: 'oc-session',
          messageID: 'assistant-message',
          type: 'text',
          text: 'Hi',
          time: { start: 4 },
        },
        time: 4,
      },
    } as OpenCodeRuntimeEvent)
    route({
      id: 'event-text-delta',
      type: 'message.part.delta',
      properties: {
        sessionID: 'oc-session',
        messageID: 'assistant-message',
        partID: 'text-part',
        field: 'text',
        delta: ' there',
      },
    } as OpenCodeRuntimeEvent)
    const completedTool = {
      id: 'tool-part',
      sessionID: 'oc-session',
      messageID: 'assistant-message',
      type: 'tool' as const,
      callID: 'tool-call',
      tool: 'task',
      state: {
        status: 'completed' as const,
        input: { description: 'Inspect' },
        output: 'Done',
        title: 'Inspect',
        metadata: {},
        time: { start: 5, end: 6 },
      },
    }
    route({
      id: 'event-tool',
      type: 'message.part.updated',
      properties: { sessionID: 'oc-session', part: completedTool, time: 6 },
    } as OpenCodeRuntimeEvent)
    route({
      id: 'event-tool-repeat',
      type: 'message.part.updated',
      properties: { sessionID: 'oc-session', part: completedTool, time: 7 },
    } as OpenCodeRuntimeEvent)
    route({ id: 'event-idle', type: 'session.idle', properties: { sessionID: 'oc-session' } } as OpenCodeRuntimeEvent)
    await send

    const deltas = events.filter((event): event is Extract<AgentEvent, { type: 'content_delta' }> => event.type === 'content_delta')
    expect(deltas.map((event) => event.delta)).toEqual([
      { type: 'thinking', thinking: 'Think', startedAt: 3, endedAt: undefined },
      { type: 'text', text: 'Hi' },
      { type: 'text', text: ' there' },
      {
        type: 'tool_use',
        toolName: 'Agent',
        toolUseId: 'tool-call',
        input: '{"description":"Inspect"}',
        status: 'complete',
        startedAt: 5,
      },
      { type: 'tool_result', toolUseId: 'tool-call', summary: 'Done', isError: false },
      {
        type: 'tool_use',
        toolName: 'Agent',
        toolUseId: 'tool-call',
        input: '{"description":"Inspect"}',
        status: 'complete',
        startedAt: 5,
      },
    ])
    const complete = events.find((event): event is Extract<AgentEvent, { type: 'message_complete' }> => event.type === 'message_complete')
    expect(complete?.metadata).toMatchObject({ model: 'openai/gpt-5', costUsd: 0.01, stopReason: 'stop' })
    expect(deltas.some((event) => event.delta.type === 'text' && event.delta.text === 'hello')).toBe(false)
    await backend.close()
  })

  it('routes permissions, questions and live permission mode changes', async () => {
    const backend = new OpenCodeBackend()
    await backend.start(startOptions())

    route({
      id: 'permission-event',
      type: 'permission.asked',
      properties: {
        id: 'permission-1',
        sessionID: 'oc-session',
        permission: 'bash',
        patterns: ['git status'],
        metadata: { command: 'git status' },
        always: ['git *'],
      },
    } as OpenCodeRuntimeEvent)
    expect(backend.getPendingInteractions()).toHaveLength(1)
    expect(backend.respondToPermission('permission-1', true, true)).toBe(true)
    expect(permissionReply).toHaveBeenCalledWith('permission-1', 'always')

    route({
      id: 'question-event',
      type: 'question.asked',
      properties: {
        id: 'question-1',
        sessionID: 'oc-session',
        questions: [
          { question: 'Pick values', header: 'Values', options: [], multiple: true },
          { question: 'Name it', header: 'Name', options: [], multiple: false },
        ],
      },
    } as OpenCodeRuntimeEvent)
    backend.respondToQuestion('question-1', { 'Pick values': 'A, B', 'Name it': 'One, Two' })
    expect(questionReply).toHaveBeenCalledWith('question-1', [['A', 'B'], ['One, Two']])

    await backend.setPermissionMode('plan')
    expect(setPermissionMode).toHaveBeenCalledWith('plan')
    await backend.close()
    expect(questionReject).not.toHaveBeenCalled()
  })
})
