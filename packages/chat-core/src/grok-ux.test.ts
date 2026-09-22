import { describe, expect, it } from 'vitest'
import { applyEventToSession } from './reducer'
import { createDefaultChatCoreSession } from './defaults'

describe('Grok UX reducer slices', () => {
  it('keeps multiple follow-up suggestions', () => {
    const session = createDefaultChatCoreSession()
    const patch = applyEventToSession(session, {
      type: 'prompt_suggestion',
      suggestion: 'Run tests',
      suggestions: ['Run tests', 'Open PR'],
    })
    expect(patch.promptSuggestions).toEqual(['Run tests', 'Open PR'])
  })

  it('stores live MCP status and clears waiting elicitation', () => {
    const session = createDefaultChatCoreSession()
    Object.assign(session, applyEventToSession(session, {
      type: 'mcp_status',
      servers: [{ name: 'github', status: 'connected' }],
      init: { connected: 1, total: 2 },
    }))
    expect(session.mcpServers).toEqual([{ name: 'github', status: 'connected' }])
    expect(session.mcpInitProgress).toEqual({ connected: 1, total: 2 })
    session.waitingElicitation = {
      url: 'https://example.com',
      serverName: 'github',
      message: 'Sign in',
    }
    expect(applyEventToSession(session, {
      type: 'elicitation_complete',
      mcpServerName: 'github',
      elicitationId: 'e-1',
    })).toEqual({ waitingElicitation: null })
  })

  it('keeps a failed task row when later progress arrives', () => {
    const session = createDefaultChatCoreSession()
    Object.assign(session, applyEventToSession(session, {
      type: 'task_started',
      taskId: 'task-1',
      toolUseId: 'tu-1',
      description: 'Run workflow',
      taskType: 'workflow',
    }))
    Object.assign(session, applyEventToSession(session, {
      type: 'task_notification',
      taskId: 'task-1',
      toolUseId: 'tu-1',
      taskStatus: 'failed',
      outputFile: '',
      summary: 'boom',
      usage: { totalTokens: 1, toolUses: 1, durationMs: 10 },
    }))
    expect(session.taskProgress['tu-1']?.status).toBe('failed')
    expect(applyEventToSession(session, {
      type: 'task_progress',
      taskId: 'task-1',
      toolUseId: 'tu-1',
      description: 'still going?',
      usage: { totalTokens: 2, toolUses: 2, durationMs: 20 },
    })).toEqual({})
    expect(session.taskProgress['tu-1']?.status).toBe('failed')
  })

  it('renders a slash-launched workflow that never emits a tool call', () => {
    const session = createDefaultChatCoreSession()
    session.messages = [{
      id: 'u1', role: 'user', status: 'complete', createdAt: '', providerId: 'acp',
      content: [{ type: 'text', text: '/grok-build-parity' }],
    }]
    Object.assign(session, applyEventToSession(session, {
      type: 'task_started',
      taskId: 'wf_1',
      description: 'grok-build-parity: Clone/update grok-build source',
      taskType: 'workflow',
    }))
    const card = session.messages.find((message) => message.id === 'host-workflow-wf_1')
    expect(card?.content[0]).toMatchObject({
      type: 'tool_use', toolName: 'Workflow', toolUseId: 'wf_1', workflowName: 'grok-build-parity',
    })
    expect(JSON.parse((card!.content[0] as { input: string }).input).name).toBe('grok-build-parity')
    expect(card?.content[1]).toMatchObject({
      type: 'tool_result',
      summary: JSON.stringify({ run_id: 'wf_1', task_id: 'wf_1', name: 'grok-build-parity' }),
    })

    Object.assign(session, applyEventToSession(session, {
      type: 'task_progress',
      taskId: 'wf_1',
      description: 'grok-build-parity: Clone/update grok-build source',
      summary: 'phase: Catalog',
      currentPhase: 'Catalog',
      workflowPhases: [
        { title: 'Source', state: 'done' },
        { title: 'Catalog', state: 'active' },
      ],
      usage: { totalTokens: 10, toolUses: 4, durationMs: 1000 },
    }))
    const live = session.messages.find((message) => message.id === 'host-workflow-wf_1')
    expect(live?.content[0]).toMatchObject({
      workflowCurrentPhase: 'Catalog',
      workflowPhases: [
        { title: 'Source', state: 'done' },
        { title: 'Catalog', state: 'active' },
      ],
    })
    expect(session.taskProgress.wf_1?.completed).toBe(false)
  })

  it('builds the host card from a later progress snapshot when task_started was missed', () => {
    const session = createDefaultChatCoreSession()
    session.messages = [{
      id: 'u1', role: 'user', status: 'complete', createdAt: '', providerId: 'acp',
      content: [{ type: 'text', text: '/grok-build-parity' }],
    }]
    Object.assign(session, applyEventToSession(session, {
      type: 'task_progress',
      taskId: 'wf_1',
      description: 'grok-build-parity: Clone/update grok-build source',
      currentPhase: 'Catalog',
      workflowPhases: [{ title: 'Catalog', state: 'active' }],
      usage: { totalTokens: 1, toolUses: 1, durationMs: 10 },
    }))
    const card = session.messages.find((message) => message.id === 'host-workflow-wf_1')
    expect(card?.content[0]).toMatchObject({
      type: 'tool_use', toolName: 'Workflow', workflowCurrentPhase: 'Catalog',
    })
  })

  it('keeps a model-launched workflow on its own tool block', () => {
    const session = createDefaultChatCoreSession()
    session.messages = [{
      id: 'u1', role: 'user', status: 'complete', createdAt: '', providerId: 'acp',
      content: [{ type: 'text', text: 'run it' }],
    }, {
      id: 'a1', role: 'assistant', status: 'streaming', createdAt: '', providerId: 'acp',
      content: [{ type: 'tool_use', toolName: 'Workflow', toolUseId: 'tu-1', input: '{"name":"review-changes"}' }],
    }]
    const patch = applyEventToSession(session, {
      type: 'task_started',
      taskId: 'wf_live',
      description: 'review-changes: review',
      taskType: 'workflow',
    })
    expect(patch.messages).toBeUndefined()
  })

  it('drops the host card once the real workflow tool result names the run', () => {
    const session = createDefaultChatCoreSession()
    session.messages = [{
      id: 'u1', role: 'user', status: 'complete', createdAt: '', providerId: 'acp',
      content: [{ type: 'text', text: 'run it' }],
    }, {
      id: 'a1', role: 'assistant', status: 'streaming', createdAt: '', providerId: 'acp',
      content: [],
    }]
    Object.assign(session, applyEventToSession(session, {
      type: 'task_started',
      taskId: 'wf_live',
      description: 'review-changes: review',
      taskType: 'workflow',
    }))
    expect(session.messages.some((message) => message.id === 'host-workflow-wf_live')).toBe(true)
    Object.assign(session, applyEventToSession(session, {
      type: 'content_delta',
      messageId: 'a1',
      delta: { type: 'tool_use', toolName: 'Workflow', toolUseId: 'tu-1', input: '{"name":"review-changes"}' },
    }))
    Object.assign(session, applyEventToSession(session, {
      type: 'content_delta',
      messageId: 'a1',
      delta: {
        type: 'tool_result',
        toolUseId: 'tu-1',
        summary: JSON.stringify({ run_id: 'wf_live', name: 'review-changes' }),
      },
    }))
    expect(session.messages.some((message) => message.id === 'host-workflow-wf_live')).toBe(false)
    const launch = session.messages.find((message) => message.id === 'a1')
    expect(launch?.content.some((block) => block.type === 'tool_use' && block.toolUseId === 'tu-1')).toBe(true)
  })

  it('stamps the task lifecycle onto the Workflow block for surfaces without taskProgress', () => {
    const session = createDefaultChatCoreSession()
    session.messages = [{
      id: 'm1', role: 'assistant', status: 'streaming', createdAt: '', providerId: 'acp',
      content: [{ type: 'tool_use', toolName: 'Workflow', toolUseId: 'tu-1', input: '{}' }],
    }]
    Object.assign(session, applyEventToSession(session, {
      type: 'task_progress',
      taskId: 'wf-1',
      toolUseId: 'tu-1',
      description: 'parity: catalog capabilities',
      usage: { totalTokens: 5, toolUses: 1, durationMs: 100 },
    }))
    const running = session.messages[0]!.content[0] as { taskDescription?: string; taskStatus?: string }
    expect(running.taskDescription).toBe('parity: catalog capabilities')
    expect(running.taskStatus).toBeUndefined()
    Object.assign(session, applyEventToSession(session, {
      type: 'task_notification',
      taskId: 'wf-1',
      toolUseId: 'tu-1',
      taskStatus: 'failed',
      outputFile: '',
      summary: 'budget exhausted',
      usage: { totalTokens: 9, toolUses: 2, durationMs: 200 },
    }))
    const done = session.messages[0]!.content[0] as { taskStatus?: string; taskSummary?: string }
    expect(done.taskStatus).toBe('failed')
    expect(done.taskSummary).toBe('budget exhausted')
  })

  it('keeps the current ACP model when the catalog drops it', () => {
    const session = createDefaultChatCoreSession()
    session.sessionProvider = 'acp'
    session.acpAgentId = 'grok-build'
    session.selectedModel = 'grok-4'
    session.modelUserChosen = true
    const patch = applyEventToSession(session, {
      type: 'acp_models',
      models: [{ id: 'grok-3', name: 'Grok 3', description: '' }],
      selectedModelId: 'grok-3',
      configId: 'model',
      status: 'ready',
      agentId: 'grok-build',
    })
    expect(patch.selectedModel).toBeUndefined()
    expect(patch.acpModels?.some((m) => m.id === 'grok-4')).toBe(true)
  })

  it('does not clear exhausted apiRetry on idle', () => {
    const session = createDefaultChatCoreSession()
    session.apiRetry = { attempt: 3, delayMs: 0, phase: 'exhausted', message: 'timeout' }
    const patch = applyEventToSession(session, { type: 'status_change', status: 'idle' })
    expect(patch.apiRetry).toBeUndefined()
  })

  it('mints a recap row and does not duplicate it on replay', () => {
    const session = createDefaultChatCoreSession()
    const first = applyEventToSession(session, {
      type: 'session_recap',
      summary: 'Wired recap onto mobile restore.',
      auto: true,
    })
    expect(first.messages).toHaveLength(1)
    const recap = first.messages![0]
    expect(recap.providerId).toBe('system')
    const text = (recap.content[0] as { text: string }).text
    expect(JSON.parse(text.slice('__turn_meta__:'.length))).toEqual({
      kind: 'recap',
      text: 'Wired recap onto mobile restore.',
      auto: true,
    })
    Object.assign(session, first)
    expect(applyEventToSession(session, {
      type: 'session_recap',
      summary: 'Wired recap onto mobile restore.',
      auto: true,
    })).toEqual({ isRecapping: false })
  })
})
