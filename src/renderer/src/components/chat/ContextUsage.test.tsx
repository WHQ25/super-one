/** @vitest-environment jsdom */

import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const chatState = {
  availableModels: [] as Array<{ id: string; name: string; description: string }>,
  activeProject: '/test',
}

const activeSessionState = {
  contextTokens: 0,
  contextWindow: null as number | null,
  selectedModel: '',
  preferredProvider: 'claude' as 'claude' | 'codex',
  sessionProvider: null as 'claude' | 'codex' | null,
  totalCostUsd: 0,
  status: 'idle' as string,
}

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
  useActiveSession: (selector: (state: typeof activeSessionState) => unknown) => selector(activeSessionState),
}))

import { ContextUsage } from './ContextUsage'

beforeEach(() => {
  chatState.availableModels = []
  activeSessionState.contextTokens = 0
  activeSessionState.contextWindow = null
  activeSessionState.selectedModel = ''
  activeSessionState.preferredProvider = 'claude'
  activeSessionState.sessionProvider = null
  activeSessionState.totalCostUsd = 0
  activeSessionState.status = 'idle'
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
})
