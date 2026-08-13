/** @vitest-environment jsdom */

import { render, screen, fireEvent, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelCatalog } from '@superone/shared/model-catalog-types'

const chatState = {
  availableModels: [] as Array<{ id: string; name: string; description: string; resolvedModel?: string; contextWindow?: number }>,
  activeProject: '/test',
  setDetailedUsage: vi.fn(),
  harnessResources: {
    cursor: {
      models: [] as Array<{
        id: string
        name: string
        description?: string
        contextWindow?: number
        parameters?: Array<{ id: string; values: Array<{ value: string }> }>
      }>,
    },
  },
}

const activeSessionState = {
  contextTokens: 0,
  contextWindow: null as number | null,
  selectedModel: '',
  cursorModelParams: {} as Record<string, string>,
  preferredProvider: 'claude' as 'claude' | 'codex' | 'opencode' | 'cursor' | 'acp',
  sessionProvider: null as 'claude' | 'codex' | 'opencode' | 'cursor' | 'acp' | null,
  totalCostUsd: 0,
  status: 'idle' as string,
  detailedUsage: null as unknown,
  _activeSessionId: 'sid-1' as string | null,
}

let getContextUsageMock = vi.fn(async (_projectPath: string, _sessionId?: string) => null as unknown)
let modelCatalog: ModelCatalog | null = null

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
  useActiveSession: (selector: (state: typeof activeSessionState) => unknown) => selector(activeSessionState),
  useSessionScope: () => null,
  selectClaudeModels: () => chatState.availableModels,
}))

vi.mock('@/hooks/useModelCatalog', () => ({
  useModelCatalog: () => ({
    catalog: modelCatalog,
    loading: false,
    refreshing: false,
    refresh: async () => {},
  }),
}))

import { ContextUsage } from './ContextUsage'

function catalogWithModel(id: string, contextWindow: number, providerId = 'anthropic'): ModelCatalog {
  return {
    generatedAt: '2026-01-01',
    source: 'snapshot',
    providers: [{
      id: providerId,
      name: providerId,
      npm: '',
      env: [],
      doc: '',
      models: [{
        id,
        name: id,
        providerId,
        contextWindow,
        inputModalities: ['text'],
        outputModalities: ['text'],
        reasoning: false,
        toolCall: true,
        attachment: false,
      }],
    }],
  }
}

beforeEach(() => {
  chatState.availableModels = []
  chatState.setDetailedUsage = vi.fn()
  chatState.harnessResources.cursor.models = []
  activeSessionState.contextTokens = 0
  activeSessionState.contextWindow = null
  activeSessionState.selectedModel = ''
  activeSessionState.cursorModelParams = {}
  activeSessionState.preferredProvider = 'claude'
  activeSessionState.sessionProvider = null
  activeSessionState.totalCostUsd = 0
  activeSessionState.status = 'idle'
  activeSessionState.detailedUsage = null
  activeSessionState._activeSessionId = 'sid-1'
  modelCatalog = null
  getContextUsageMock = vi.fn(async (_projectPath: string, _sessionId?: string) => null)
  Object.defineProperty(window, 'agent', {
    configurable: true,
    value: {
      getContextUsage: (projectPath: string, sessionId?: string) => getContextUsageMock(projectPath, sessionId),
    },
  })
})

describe('ContextUsage', () => {
  it('uses the 272k managed window for Codex GPT-5.6', () => {
    modelCatalog = catalogWithModel('gpt-5.6-sol', 1_050_000, 'openai')
    chatState.availableModels = [{ id: 'gpt-5.6-sol', name: 'GPT5.6 Sol', description: '' }]
    activeSessionState.contextTokens = 120_000
    activeSessionState.contextWindow = 258_400
    activeSessionState.selectedModel = 'gpt-5.6-sol'
    activeSessionState.preferredProvider = 'codex'
    activeSessionState.sessionProvider = 'codex'

    render(<ContextUsage />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Context: 120.0k / 272.0k (44%)')).toBeTruthy()
    expect(screen.queryByText(/1050\.0k/)).toBeNull()
  })

  it('uses the session context window for codex', () => {
    chatState.availableModels = [{ id: 'claude-1m', name: 'Claude 1M', description: '' }]
    activeSessionState.contextTokens = 120000
    activeSessionState.contextWindow = 258400
    activeSessionState.selectedModel = 'claude-1m'
    activeSessionState.preferredProvider = 'codex'
    activeSessionState.sessionProvider = 'codex'

    render(<ContextUsage />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Context: 120.0k / 258.4k (46%)')).toBeTruthy()
    expect(screen.queryByText(/1000\.0k/)).toBeNull()
  })

  it('does not guess a codex context window from the model name', () => {
    chatState.availableModels = [{ id: 'claude-1m', name: 'Claude 1M', description: '' }]
    activeSessionState.contextTokens = 120000
    activeSessionState.selectedModel = 'claude-1m'
    activeSessionState.preferredProvider = 'codex'
    activeSessionState.sessionProvider = 'codex'

    render(<ContextUsage />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Context: 120.0k')).toBeTruthy()
    expect(screen.queryByText(/1000\.0k/)).toBeNull()
  })

  it('uses the 1M window for a Claude model whose id carries [1m]', () => {
    chatState.availableModels = [{ id: 'opus[1m]', name: 'Opus', description: '' }]
    activeSessionState.contextTokens = 120000
    activeSessionState.selectedModel = 'opus[1m]'
    activeSessionState.preferredProvider = 'claude'
    activeSessionState.sessionProvider = 'claude'

    render(<ContextUsage />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Context: 120.0k / 1000.0k (12%)')).toBeTruthy()
  })

  it('uses the 1M window when only resolvedModel carries [1m]', () => {
    chatState.availableModels = [{ id: 'fable', name: 'Fable', description: '', resolvedModel: 'claude-fable-5[1m]' }]
    activeSessionState.contextTokens = 120000
    activeSessionState.selectedModel = 'fable'
    activeSessionState.preferredProvider = 'claude'
    activeSessionState.sessionProvider = 'claude'

    render(<ContextUsage />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Context: 120.0k / 1000.0k (12%)')).toBeTruthy()
  })

  it('falls back to the 200k window for a Claude model without [1m]', () => {
    chatState.availableModels = [{ id: 'claude-opus-4-8', name: 'Opus', description: '' }]
    activeSessionState.contextTokens = 120000
    activeSessionState.selectedModel = 'claude-opus-4-8'
    activeSessionState.preferredProvider = 'claude'
    activeSessionState.sessionProvider = 'claude'

    render(<ContextUsage />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Context: 120.0k / 200.0k (60%)')).toBeTruthy()
  })

  it('does not clear detailedUsage when switching to a different session with the same model', () => {
    chatState.availableModels = [{ id: 'claude-sonnet-4-6', name: 'Sonnet', description: '' }]
    activeSessionState.selectedModel = 'claude-sonnet-4-6'
    activeSessionState._activeSessionId = 'sid-A'
    activeSessionState.contextTokens = 1000
    activeSessionState.detailedUsage = { totalTokens: 5000, maxTokens: 200000, percentage: 2.5, model: 'claude-sonnet-4-6', categories: [] }

    const { rerender } = render(<ContextUsage />)
    expect(chatState.setDetailedUsage).not.toHaveBeenCalled()

    act(() => {
      activeSessionState._activeSessionId = 'sid-B'
    })
    rerender(<ContextUsage />)

    expect(chatState.setDetailedUsage).not.toHaveBeenCalled()
  })

  it('clears detailedUsage when changing model within the same session', () => {
    chatState.availableModels = [
      { id: 'claude-sonnet-4-6', name: 'Sonnet', description: '' },
      { id: 'claude-opus-4-7', name: 'Opus', description: '' },
    ]
    activeSessionState.selectedModel = 'claude-sonnet-4-6'
    activeSessionState._activeSessionId = 'sid-A'

    const { rerender } = render(<ContextUsage />)
    expect(chatState.setDetailedUsage).not.toHaveBeenCalled()

    act(() => {
      activeSessionState.selectedModel = 'claude-opus-4-7'
    })
    rerender(<ContextUsage />)

    expect(chatState.setDetailedUsage).toHaveBeenCalledWith('/test', 'sid-A', null)
  })

  it('refreshes detailed context usage after an OpenCode turn completes', async () => {
    activeSessionState.preferredProvider = 'opencode'
    activeSessionState.sessionProvider = 'opencode'
    activeSessionState.contextTokens = 12_000
    activeSessionState.status = 'streaming'
    getContextUsageMock = vi.fn(async (_projectPath: string, _sessionId?: string) => ({
      categories: [{ name: 'Input', tokens: 12_000, color: '#22c55e' }],
      totalTokens: 12_000,
      maxTokens: 400_000,
      percentage: 3,
      model: 'openai/gpt-5',
    }))

    const { rerender } = render(<ContextUsage />)
    act(() => { activeSessionState.status = 'idle' })
    rerender(<ContextUsage />)

    await vi.waitFor(() => expect(getContextUsageMock).toHaveBeenCalledWith('/test', 'sid-1'))
    expect(chatState.setDetailedUsage).toHaveBeenCalledWith('/test', 'sid-1', expect.objectContaining({ maxTokens: 400_000 }))
  })

  it('refreshes detailed context usage after an ACP/Grok turn completes', async () => {
    activeSessionState.preferredProvider = 'acp' as never
    activeSessionState.sessionProvider = 'acp' as never
    activeSessionState.contextTokens = 42_000
    activeSessionState.status = 'streaming'
    getContextUsageMock = vi.fn(async () => ({
      categories: [],
      totalTokens: 42_000,
      maxTokens: 500_000,
      percentage: 8,
      model: 'grok-4.5',
    }))

    const { rerender } = render(<ContextUsage />)
    act(() => { activeSessionState.status = 'idle' })
    rerender(<ContextUsage />)

    await vi.waitFor(() => expect(getContextUsageMock).toHaveBeenCalledWith('/test', 'sid-1'))
    expect(chatState.setDetailedUsage).toHaveBeenCalledWith('/test', 'sid-1', expect.objectContaining({ maxTokens: 500_000 }))
  })

  it('uses model.contextWindow for acp when session window is missing', () => {
    chatState.availableModels = [{ id: 'grok-4.5', name: 'Grok 4.5', description: '', contextWindow: 500_000 } as never]
    activeSessionState.contextTokens = 50_000
    activeSessionState.selectedModel = 'grok-4.5'
    activeSessionState.preferredProvider = 'acp' as never
    activeSessionState.sessionProvider = 'acp' as never

    render(<ContextUsage />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Context: 50.0k / 500.0k (10%)')).toBeTruthy()
  })

  it('prefers models.dev catalog contextWindow over session and detailed maxTokens', () => {
    modelCatalog = catalogWithModel('claude-sonnet-4-6', 1_000_000)
    chatState.availableModels = [{ id: 'claude-sonnet-4-6', name: 'Sonnet', description: '' }]
    activeSessionState.contextTokens = 120_000
    activeSessionState.contextWindow = 258_400
    activeSessionState.selectedModel = 'claude-sonnet-4-6'
    activeSessionState.preferredProvider = 'claude'
    activeSessionState.sessionProvider = 'claude'
    activeSessionState.detailedUsage = {
      totalTokens: 120_000,
      maxTokens: 200_000,
      percentage: 60,
      model: 'claude-sonnet-4-6',
      categories: [],
    }

    render(<ContextUsage />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Context: 120.0k / 1000.0k (12%)')).toBeTruthy()
    expect(screen.queryByText(/258\.4k/)).toBeNull()
    expect(screen.queryByText(/200\.0k/)).toBeNull()
  })

  it('looks up models.dev by stripped [1m] id', () => {
    modelCatalog = catalogWithModel('claude-sonnet-4-6', 1_000_000)
    chatState.availableModels = [{ id: 'claude-sonnet-4-6[1m]', name: 'Sonnet', description: '' }]
    activeSessionState.contextTokens = 120_000
    activeSessionState.selectedModel = 'claude-sonnet-4-6[1m]'
    activeSessionState.preferredProvider = 'claude'
    activeSessionState.sessionProvider = 'claude'

    render(<ContextUsage />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Context: 120.0k / 1000.0k (12%)')).toBeTruthy()
  })

  it('uses the selected Cursor context param instead of models.dev', () => {
    modelCatalog = catalogWithModel('claude-sonnet-4-5', 200_000)
    chatState.harnessResources.cursor.models = [{
      id: 'claude-sonnet-4-5',
      name: 'Sonnet',
      parameters: [{ id: 'context', values: [{ value: 'auto' }, { value: '300k' }, { value: '1m' }] }],
    }]
    activeSessionState.contextTokens = 50_000
    activeSessionState.selectedModel = 'claude-sonnet-4-5'
    activeSessionState.cursorModelParams = { context: '300k' }
    activeSessionState.preferredProvider = 'cursor'
    activeSessionState.sessionProvider = 'cursor'

    render(<ContextUsage />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Context: 50.0k / 300.0k (17%)')).toBeTruthy()
    expect(screen.queryByText(/200\.0k/)).toBeNull()
  })

  it('does not use models.dev when Cursor context is auto and catalog has a numeric fallback', () => {
    modelCatalog = catalogWithModel('claude-sonnet-4-5', 200_000)
    chatState.harnessResources.cursor.models = [{
      id: 'claude-sonnet-4-5',
      name: 'Sonnet',
      parameters: [{ id: 'context', values: [{ value: 'auto' }, { value: '300k' }, { value: '1m' }] }],
    }]
    activeSessionState.contextTokens = 50_000
    activeSessionState.selectedModel = 'claude-sonnet-4-5'
    activeSessionState.cursorModelParams = { context: 'auto' }
    activeSessionState.preferredProvider = 'cursor'
    activeSessionState.sessionProvider = 'cursor'

    render(<ContextUsage />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Context: 50.0k / 300.0k (17%)')).toBeTruthy()
    expect(screen.queryByText(/200\.0k/)).toBeNull()
  })

  it('uses the session context window for Cursor when no param is parseable', () => {
    modelCatalog = catalogWithModel('claude-sonnet-4-5', 200_000)
    activeSessionState.contextTokens = 50_000
    activeSessionState.contextWindow = 1_000_000
    activeSessionState.selectedModel = 'claude-sonnet-4-5'
    activeSessionState.preferredProvider = 'cursor'
    activeSessionState.sessionProvider = 'cursor'

    render(<ContextUsage />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Context: 50.0k / 1000.0k (5%)')).toBeTruthy()
    expect(screen.queryByText(/200\.0k/)).toBeNull()
  })

  it('refreshes detailed context usage after a Cursor turn completes', async () => {
    activeSessionState.preferredProvider = 'cursor'
    activeSessionState.sessionProvider = 'cursor'
    activeSessionState.contextTokens = 12_000
    activeSessionState.status = 'streaming'
    getContextUsageMock = vi.fn(async (_projectPath: string, _sessionId?: string) => ({
      categories: [{ name: 'tokens', tokens: 12_000, color: 'var(--muted-foreground)' }],
      totalTokens: 12_000,
      maxTokens: 300_000,
      percentage: 4,
      model: 'claude-sonnet-4-5',
    }))

    const { rerender } = render(<ContextUsage />)
    act(() => { activeSessionState.status = 'idle' })
    rerender(<ContextUsage />)

    await vi.waitFor(() => expect(getContextUsageMock).toHaveBeenCalledWith('/test', 'sid-1'))
    expect(chatState.setDetailedUsage).toHaveBeenCalledWith('/test', 'sid-1', expect.objectContaining({ maxTokens: 300_000 }))
  })
})
