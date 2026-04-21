/** @vitest-environment jsdom */

import { render, screen, fireEvent, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const chatState = {
  availableModels: [] as Array<{ id: string; name: string; description: string }>,
  activeProject: '/test',
  setDetailedUsage: vi.fn(),
}

const activeSessionState = {
  contextTokens: 0,
  contextWindow: null as number | null,
  selectedModel: '',
  preferredProvider: 'claude' as 'claude' | 'codex',
  sessionProvider: null as 'claude' | 'codex' | null,
  totalCostUsd: 0,
  status: 'idle' as string,
  detailedUsage: null as unknown,
  _activeSessionId: 'sid-1' as string | null,
}

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
  useActiveSession: (selector: (state: typeof activeSessionState) => unknown) => selector(activeSessionState),
}))

import { ContextUsage } from './ContextUsage'

beforeEach(() => {
  chatState.availableModels = []
  chatState.setDetailedUsage = vi.fn()
  activeSessionState.contextTokens = 0
  activeSessionState.contextWindow = null
  activeSessionState.selectedModel = ''
  activeSessionState.preferredProvider = 'claude'
  activeSessionState.sessionProvider = null
  activeSessionState.totalCostUsd = 0
  activeSessionState.status = 'idle'
  activeSessionState.detailedUsage = null
  activeSessionState._activeSessionId = 'sid-1'
})

describe('ContextUsage', () => {
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

  it('keeps the Claude fallback when the session context window is unknown', () => {
    chatState.availableModels = [{ id: 'claude-1m', name: 'Claude 1M', description: '' }]
    activeSessionState.contextTokens = 120000
    activeSessionState.selectedModel = 'claude-1m'
    activeSessionState.preferredProvider = 'claude'
    activeSessionState.sessionProvider = 'claude'

    render(<ContextUsage />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Context: 120.0k / 1000.0k (12%)')).toBeTruthy()
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
})
