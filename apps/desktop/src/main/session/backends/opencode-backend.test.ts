import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { OpenCodeRuntime, OpenCodeRuntimeEvent, OpenCodeRuntimeOptions } from '../../opencode/opencode-runtime'

vi.mock('../../logger', () => ({ default: { debug: vi.fn(), warn: vi.fn() } }))
vi.mock('../../mcp-config-service', () => ({ listMcpConfigs: () => [] }))
vi.mock('../../mcp/superone-mcp-stdio-state', () => ({ getSuperoneMcpStdioConfig: () => null }))

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
  let command: ReturnType<typeof vi.fn>
  let init: ReturnType<typeof vi.fn>
  let compact: ReturnType<typeof vi.fn>
  let getContextUsage: ReturnType<typeof vi.fn>
  let diff: ReturnType<typeof vi.fn>
  let revert: ReturnType<typeof vi.fn>
  let unrevert: ReturnType<typeof vi.fn>
  let setPermissionMode: ReturnType<typeof vi.fn>
  let permissionReply: ReturnType<typeof vi.fn>
  let questionReply: ReturnType<typeof vi.fn>
  let questionReject: ReturnType<typeof vi.fn>
  let getMcpServerStatus: ReturnType<typeof vi.fn>
  let authenticateMcp: ReturnType<typeof vi.fn>
  let reconnectMcp: ReturnType<typeof vi.fn>
  let toggleMcpServer: ReturnType<typeof vi.fn>
  let reloadMcpServers: ReturnType<typeof vi.fn>
  let close: ReturnType<typeof vi.fn>

  beforeEach(() => {
    route = () => undefined
    prompt = vi.fn(async () => undefined)
    command = vi.fn(async () => undefined)
    init = vi.fn(async () => undefined)
    compact = vi.fn(async () => undefined)
    getContextUsage = vi.fn(async () => ({
      categories: [{ name: 'Input', tokens: 20, color: '#22c55e' }],
      totalTokens: 20,
      maxTokens: 400_000,
      percentage: 0.005,
      model: 'openai/gpt-5',
    }))
    diff = vi.fn(async () => [
      { file: 'src/app.ts', additions: 3, deletions: 1, status: 'modified' as const },
      { file: 'src/new.ts', additions: 5, deletions: 0, status: 'added' as const },
    ])
    revert = vi.fn(async () => undefined)
    unrevert = vi.fn(async () => undefined)
    setPermissionMode = vi.fn(async () => undefined)
    permissionReply = vi.fn(async () => undefined)
    questionReply = vi.fn(async () => undefined)
    questionReject = vi.fn(async () => undefined)
    getMcpServerStatus = vi.fn(async () => [{ name: 'github', status: 'connected' as const }])
    authenticateMcp = vi.fn(async () => undefined)
    reconnectMcp = vi.fn(async () => undefined)
    toggleMcpServer = vi.fn(async () => undefined)
    reloadMcpServers = vi.fn(async () => undefined)
    close = vi.fn(async () => undefined)
    runtime = {
      sessionId: 'oc-session',
      models: [{ id: 'openai/gpt-5', name: 'GPT-5', description: '', contextWindow: 400_000 }],
      agents: [],
      commands: [{ name: 'review', description: '', argumentHint: '', isSkill: false }],
      initialTodos: [],
      pendingPermissions: [],
      pendingQuestions: [],
      prompt,
      command,
      init,
      compact,
      getContextUsage,
      diff,
      revert,
      unrevert,
      setModel: vi.fn(async () => undefined),
      setPermissionMode,
      cancel: vi.fn(async () => undefined),
      permissionReply,
      questionReply,
      questionReject,
      getMcpServerStatus,
      authenticateMcp,
      reconnectMcp,
      toggleMcpServer,
      reloadMcpServers,
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
    expect(complete?.metadata).toMatchObject({
      model: 'openai/gpt-5',
      costUsd: 0.01,
      stopReason: 'stop',
      forkAnchorId: 'assistant-message',
    })
    expect(events).toContainEqual({
      type: 'checkpoint_captured',
      messageId: 'assistant-local',
      checkpointId: 'user-message',
      resumePointId: 'user-message',
    })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'message_usage',
      contextTokens: 20,
      contextWindow: 400_000,
    }))
    expect(deltas.some((event) => event.delta.type === 'text' && event.delta.text === 'hello')).toBe(false)
    await backend.close()
  })

  it('restores todo and pending interaction snapshots on session resume', async () => {
    Object.assign(runtime, {
      initialTodos: [{ content: 'Resume work', status: 'in_progress', priority: 'high' }],
      pendingPermissions: [{
        id: 'permission-snapshot',
        sessionID: 'oc-session',
        action: 'bash',
        resources: ['git status'],
        save: ['git *'],
      }],
      pendingQuestions: [{
        id: 'question-snapshot',
        sessionID: 'oc-session',
        questions: [{ question: 'Continue?', header: 'Continue', options: [], multiple: false }],
      }],
    })
    const backend = new OpenCodeBackend()
    const events: AgentEvent[] = []
    backend.onEvent((event) => events.push(event))
    await backend.start(startOptions({ providerSessionId: 'oc-session' }))

    expect(events).toContainEqual({
      type: 'todos_updated',
      todos: [{ id: '1', subject: 'Resume work', description: '', status: 'in_progress' }],
    })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'permission_request',
      request: expect.objectContaining({ requestId: 'permission-snapshot', toolName: 'bash' }),
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'ask_user_question',
      request: expect.objectContaining({ requestId: 'question-snapshot' }),
    }))
    expect(backend.getPendingInteractions()).toHaveLength(2)
    await backend.close()
  })

  it('initializes project instructions through the native session endpoint', async () => {
    const backend = new OpenCodeBackend()
    await backend.start(startOptions())

    const send = backend.send({ content: '/init', model: 'openai/gpt-5' })
    await vi.waitFor(() => expect(init).toHaveBeenCalledWith('openai/gpt-5'))
    route({ id: 'idle-init', type: 'session.idle', properties: { sessionID: 'oc-session' } } as OpenCodeRuntimeEvent)
    await send
    expect(prompt).not.toHaveBeenCalled()
    expect(command).not.toHaveBeenCalled()
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

  it('routes MCP status and lifecycle calls through the runtime', async () => {
    const backend = new OpenCodeBackend()
    await backend.start(startOptions())

    expect(await backend.getMcpServerStatus()).toEqual([{ name: 'github', status: 'connected' }])
    await backend.authenticateMcp('github')
    await backend.reconnectMcp('github')
    await backend.toggleMcpServer('github', false)
    await backend.reloadMcpServers()
    expect(authenticateMcp).toHaveBeenCalledWith('github')
    expect(reconnectMcp).toHaveBeenCalledWith('github')
    expect(toggleMcpServer).toHaveBeenCalledWith('github', false)
    expect(reloadMcpServers).toHaveBeenCalledOnce()
    await backend.close()
  })

  it('dispatches known slash commands through the SDK and keeps unknown commands as prompts', async () => {
    const backend = new OpenCodeBackend()
    await backend.start(startOptions())

    const commandSend = backend.send({ content: '/review working tree', model: 'openai/gpt-5' })
    await vi.waitFor(() => expect(command).toHaveBeenCalledWith('review', 'working tree', 'openai/gpt-5', undefined, undefined, undefined))
    route({ id: 'idle-command', type: 'session.idle', properties: { sessionID: 'oc-session' } } as OpenCodeRuntimeEvent)
    await commandSend

    const promptSend = backend.send({ content: '/unknown keep this literal', model: 'openai/gpt-5' })
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledWith('/unknown keep this literal', 'openai/gpt-5', undefined, undefined, undefined))
    route({ id: 'idle-prompt', type: 'session.idle', properties: { sessionID: 'oc-session' } } as OpenCodeRuntimeEvent)
    await promptSend
    await backend.close()
  })

  it('maps retry and todo status without completing the active turn', async () => {
    const backend = new OpenCodeBackend()
    const events: AgentEvent[] = []
    backend.onEvent((event) => events.push(event))
    await backend.start(startOptions())

    const send = backend.send({ content: 'work' })
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    route({
      id: 'retry',
      type: 'session.status',
      properties: {
        sessionID: 'oc-session',
        status: { type: 'retry', attempt: 2, message: 'rate limited', next: Date.now() + 1000 },
      },
    } as OpenCodeRuntimeEvent)
    route({
      id: 'todos',
      type: 'todo.updated',
      properties: {
        sessionID: 'oc-session',
        todos: [
          { content: 'Inspect', status: 'in_progress', priority: 'high' },
          { content: 'Old task', status: 'cancelled', priority: 'low' },
        ],
      },
    } as OpenCodeRuntimeEvent)

    expect(events.some((event) => event.type === 'message_complete')).toBe(false)
    expect(events).toContainEqual(expect.objectContaining({ type: 'api_retry', attempt: 2, message: 'rate limited' }))
    expect(events).toContainEqual({
      type: 'todos_updated',
      todos: [
        { id: '1', subject: 'Inspect', description: '', status: 'in_progress' },
        { id: '2', subject: 'Old task', description: '', status: 'completed' },
      ],
    })

    route({ id: 'idle', type: 'session.idle', properties: { sessionID: 'oc-session' } } as OpenCodeRuntimeEvent)
    await send
    await backend.close()
  })

  it('compacts through summarize and emits the existing compact UI events', async () => {
    const backend = new OpenCodeBackend()
    const events: AgentEvent[] = []
    backend.onEvent((event) => events.push(event))
    await backend.start(startOptions())

    const send = backend.send({ content: '/compact', model: 'openai/gpt-5', assistantMessageId: 'compact-message' })
    await vi.waitFor(() => expect(compact).toHaveBeenCalledWith('openai/gpt-5'))
    route({ id: 'compacted', type: 'session.compacted', properties: { sessionID: 'oc-session' } } as OpenCodeRuntimeEvent)
    route({ id: 'idle', type: 'session.idle', properties: { sessionID: 'oc-session' } } as OpenCodeRuntimeEvent)
    await send

    expect(events).toContainEqual({ type: 'status_indicator', indicator: 'compacting' })
    expect(events).toContainEqual({ type: 'slash_command_output', messageId: 'compact-message', content: '' })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'compact_boundary', trigger: 'manual', preTokens: 20,
    }))
    expect(events).toContainEqual({ type: 'status_indicator', indicator: null, compactResult: 'success' })
    await backend.close()
  })

  it('previews and reverts files using the provider user message checkpoint', async () => {
    const backend = new OpenCodeBackend()
    await backend.start(startOptions())

    expect(await backend.rewindFiles('user-message', { dryRun: true })).toEqual({
      canRewind: true,
      supportsCodeOnly: false,
      filesChanged: ['src/app.ts', 'src/new.ts'],
      insertions: 8,
      deletions: 1,
    })
    expect(revert).not.toHaveBeenCalled()

    expect(await backend.rewindFiles('user-message')).toEqual(expect.objectContaining({ canRewind: true }))
    expect(revert).toHaveBeenCalledWith('user-message')
    await backend.close()
  })
})
