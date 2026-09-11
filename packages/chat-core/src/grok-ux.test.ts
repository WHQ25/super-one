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
