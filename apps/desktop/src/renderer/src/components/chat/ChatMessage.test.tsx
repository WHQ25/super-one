/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
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

function createClaudeMessage(content: ChatMessageType['content']): ChatMessageType {
  return {
    id: 'msg-1',
    role: 'assistant',
    status: 'complete',
    content,
    createdAt: new Date().toISOString(),
    providerId: 'claude',
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
  // Tests assert full process content; opt into Detail Mode so compact default doesn't hide it.
  useAppStore.setState({ detailChatMode: true })
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
                totalCacheWriteInputTokens: 0,
                totalOutputTokens: 100,
                lastInputTokens: 240,
                lastCachedInputTokens: 0,
                lastCacheWriteInputTokens: 0,
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

describe('ChatMessage MCP startup footer', () => {
  it('hides the startup state after every MCP server has settled', () => {
    render(
      <ChatMessage
        message={createCodexMessage({
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [],
              mcpStartup: [
                { name: 'superone', status: 'ready' },
                { name: 'github', status: 'ready' },
              ],
            },
          },
        })}
        sessionStatus="streaming"
        isLastAssistant
      />,
    )

    expect(screen.queryByText(/Starting MCP servers/)).toBeNull()
  })

  it('shows the startup state while an MCP server is still starting', () => {
    render(
      <ChatMessage
        message={createCodexMessage({
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [],
              mcpStartup: [
                { name: 'superone', status: 'ready' },
                { name: 'github', status: 'starting' },
              ],
            },
          },
        })}
        sessionStatus="streaming"
        isLastAssistant
      />,
    )

    expect(screen.getByText('Starting MCP servers 1/2')).toBeTruthy()
  })
})

describe('ChatMessage reasoning grouping', () => {
  it('merges two thinking blocks straddling a hidden tool into one reasoning card', () => {
    const { container } = render(
      <ChatMessage
        message={createClaudeMessage([
          { type: 'thinking', thinking: 'Let me rename the session.' },
          { type: 'tool_use', toolName: 'mcp__superone__session_rename', toolUseId: 't1', input: '{}', status: 'complete' },
          { type: 'tool_result', toolUseId: 't1', summary: 'renamed' },
          { type: 'thinking', thinking: 'Acknowledge briefly.' },
        ])}
        sessionStatus="idle"
        isLastAssistant
      />,
    )
    expect(container.querySelectorAll('.thinking-node')).toHaveLength(1)
  })

  it('keeps thinking blocks separate when split by visible content', () => {
    const { container } = render(
      <ChatMessage
        message={createClaudeMessage([
          { type: 'thinking', thinking: 'First.' },
          { type: 'text', text: 'Here is the answer.' },
          { type: 'thinking', thinking: 'Second.' },
        ])}
        sessionStatus="idle"
        isLastAssistant
      />,
    )
    expect(container.querySelectorAll('.thinking-node')).toHaveLength(2)
  })
})

function createCollabTaskMessage(text: string): ChatMessageType {
  return {
    id: 'msg-collab-1',
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: new Date().toISOString(),
    metadata: {
      source: 'collaboration',
      collaboration: { kind: 'initial_task', direction: 'inbound', fromSessionId: 'parent-1' },
    },
  }
}

/** jsdom reports every element as 0px tall, so the 50vh clamp never trips on its own. */
function stubBodyHeight(px: number): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => px })
  window.innerHeight = 800
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original)
  }
}

describe('ChatMessage collaboration initial task', () => {
  it('renders the launch task as right-aligned markdown instead of a paste chip', () => {
    const task = `## Review request\n\n${Array.from({ length: 40 }, (_, i) => `- step ${i}`).join('\n')}`
    const { container } = render(
      <ChatMessage message={createCollabTaskMessage(task)} sessionStatus="idle" isLastAssistant={false} />,
    )

    expect(screen.getByText('Agent task')).toBeInTheDocument()
    // Markdown, not the `35 lines` LongTextChip the plain-text path would produce.
    expect(container.querySelector('.chat-md')).not.toBeNull()
    expect(screen.getByText('Review request').tagName).toBe('H2')
    expect(container.querySelector('.justify-end')).not.toBeNull()
  })

  it('clamps a task taller than half the viewport until the expand toggle is clicked', () => {
    const restore = stubBodyHeight(900)
    try {
      const { container } = render(
        <ChatMessage message={createCollabTaskMessage('# Long task\n\nbody')} sessionStatus="idle" isLastAssistant={false} />,
      )

      const toggle = screen.getByRole('button', { name: 'Expand' })
      expect(container.querySelector('.max-h-\\[50vh\\]')).not.toBeNull()

      act(() => { toggle.click() })

      expect(container.querySelector('.max-h-\\[50vh\\]')).toBeNull()
      expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('leaves short tasks unclamped with no expand toggle', () => {
    const restore = stubBodyHeight(120)
    try {
      const { container } = render(
        <ChatMessage message={createCollabTaskMessage('Do the thing.')} sessionStatus="idle" isLastAssistant={false} />,
      )

      expect(screen.queryByRole('button', { name: 'Expand' })).toBeNull()
      expect(container.querySelector('.max-h-\\[50vh\\]')).toBeNull()
    } finally {
      restore()
    }
  })
})
