/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage as ChatMessageType } from '@superone/shared/agent-types'
import { ChatMessage } from './ChatMessage'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'

vi.mock('./CodexTurnView', () => ({
  CodexTurnView: () => <div data-testid="codex-turn" />,
}))

vi.mock('./ForkButton', () => ({
  ForkButton: () => <button type="button" aria-label="fork" />,
}))

function streamingMessage(content: ChatMessageType['content']): ChatMessageType {
  return {
    id: 'msg-1',
    role: 'assistant',
    status: 'streaming',
    content,
    createdAt: new Date().toISOString(),
    providerId: 'claude',
  }
}

function setupRunningCommand(command: string | null) {
  useChatStore.setState({
    activeProject: '/test',
    projectSessions: {
      '/test': {
        ...createDefaultProjectState(),
        _activeSessionId: 'sid-1',
        _sessions: {
          'sid-1': {
            ...createDefaultPerSessionState(),
            status: 'streaming' as const,
            runningSlashCommand: command ? { command, startedAt: Date.now() } : null,
          },
        },
      },
    },
  })
}

beforeEach(() => {
  useAppStore.setState({ detailChatMode: true })
})

afterEach(() => {
  useChatStore.setState({ activeProject: null, projectSessions: {} })
})

describe('running slash command notice', () => {
  it('announces the command while the turn has produced nothing', () => {
    setupRunningCommand('code-review')
    render(<ChatMessage message={streamingMessage([])} sessionStatus="streaming" isLastAssistant />)

    expect(screen.getByText(/Running \/code-review/)).toBeTruthy()
  })

  it('keeps announcing when the only block so far is blank text', () => {
    setupRunningCommand('code-review')
    render(
      <ChatMessage
        message={streamingMessage([{ type: 'text', text: '   ' }])}
        sessionStatus="streaming"
        isLastAssistant
      />,
    )

    expect(screen.getByText(/Running \/code-review/)).toBeTruthy()
  })

  it('drops the notice once the agent replies in the same turn', () => {
    setupRunningCommand('code-review')
    render(
      <ChatMessage
        message={streamingMessage([{ type: 'text', text: 'Looking at the diff.' }])}
        sessionStatus="streaming"
        isLastAssistant
      />,
    )

    expect(screen.queryByText(/Running \/code-review/)).toBeNull()
  })

  it('drops the notice once the command reaches its first tool call', () => {
    setupRunningCommand('code-review')
    render(
      <ChatMessage
        message={streamingMessage([
          { type: 'tool_use', toolName: 'Read', toolUseId: 't1', input: '{"file_path":"a.ts"}' },
        ])}
        sessionStatus="streaming"
        isLastAssistant
      />,
    )

    expect(screen.queryByText(/Running \/code-review/)).toBeNull()
  })
})
