/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage as ChatMessageType } from '@superone/shared/agent-types'
import { ChatMessage } from './ChatMessage'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'

vi.mock('./CodexTurnView', () => ({
  CodexTurnView: () => <div data-testid="codex-turn" />,
}))

vi.mock('./ForkButton', () => ({
  ForkButton: () => <button type="button" aria-label="fork" />,
}))

function createCodexMessage(overrides: Partial<ChatMessageType> = {}): ChatMessageType {
  return {
    id: 'msg-1',
    role: 'assistant',
    status: 'streaming',
    content: [],
    createdAt: new Date().toISOString(),
    providerId: 'codex',
    ...overrides,
  }
}

function setupSession(streamingTokens: { input: number; output: number }) {
  const project = createDefaultProjectState()
  const session = {
    ...createDefaultPerSessionState(),
    status: 'streaming' as const,
    streamingTokens,
  }
  useChatStore.setState({
    activeProject: '/test',
    projectSessions: {
      '/test': {
        ...project,
        _activeSessionId: 'sid-1',
        _sessions: {
          'sid-1': session,
        },
      },
    },
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  setupSession({ input: 100, output: 50 })
})

afterEach(() => {
  vi.useRealTimers()
  useChatStore.setState({
    activeProject: null,
    projectSessions: {},
  })
})

describe('ChatMessage token footer', () => {
  it('clears token highlight when the message stops streaming', () => {
    const streamingMessage = createCodexMessage()
    const { rerender } = render(
      <ChatMessage message={streamingMessage} sessionStatus="streaming" isLastAssistant />,
    )

    act(() => {
      setupSession({ input: 200, output: 80 })
    })

    expect(screen.getByText('200').parentElement).toHaveClass('text-primary')
    expect(screen.getByText('80').parentElement).toHaveClass('text-emerald-400')

    rerender(
      <ChatMessage
        message={createCodexMessage({
          status: 'complete',
          metadata: {
            consumedTokens: { input: 499820, output: 22438 },
            codex: {
              threadId: 'thread-1',
              usage: {
                totalInputTokens: 240,
                totalCachedInputTokens: 0,
                totalOutputTokens: 100,
                lastInputTokens: 240,
                lastCachedInputTokens: 0,
                lastOutputTokens: 100,
                reasoningOutputTokens: 0,
                contextWindow: 200000,
              },
              items: [],
            },
          },
        })}
        sessionStatus="idle"
        isLastAssistant
      />,
    )

    expect(screen.getByText('499.8k').parentElement).not.toHaveClass('text-primary')
    expect(screen.getByText('22.4k').parentElement).not.toHaveClass('text-emerald-400')
  })
})
