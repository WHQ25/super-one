/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage as ChatMessageType } from '@superone/shared/agent-types'
import { ChatMessage, isRedundantTurnSummaryMarker } from './ChatMessage'
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
  it('falls back to metadata.usage for completed ACP turns without consumedTokens', () => {
    render(
      <ChatMessage
        message={{
          ...createClaudeMessage([{ type: 'text', text: 'ok' }]),
          providerId: 'acp',
          metadata: {
            usage: {
              inputTokens: 1200,
              outputTokens: 340,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
            },
          },
        }}
        sessionStatus="idle"
        isLastAssistant
      />,
    )
    expect(screen.getByText('1.2k')).toBeTruthy()
    expect(screen.getByText('340')).toBeTruthy()
  })

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

function createUserMessage(text: string, id = 'msg-user-1'): ChatMessageType {
  return {
    id,
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: new Date().toISOString(),
    providerId: 'claude',
  }
}

function createCollabTaskMessage(text: string): ChatMessageType {
  return {
    id: 'msg-collab-1',
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: new Date().toISOString(),
    providerId: 'claude',
    metadata: {
      source: 'collaboration',
      collaboration: { kind: 'initial_task', direction: 'inbound', fromSessionId: 'parent-1' },
    },
  }
}

describe('ChatMessage capability mention bubble', () => {
  it('renders collab chip and following text in one inline user-text wrapper', () => {
    const body =
      '派另一个grok去集成resumeDropsTurn和小透传字段，我们继续讨论cross-session'
    const text =
      `<superone-capability><name>Agents Collaboration</name><id>collab</id></superone-capability> ${body}`
    const { container } = render(
      <ChatMessage message={createUserMessage(text)} sessionStatus="idle" isLastAssistant={false} />,
    )

    const wrap = container.querySelector('.user-text-with-mentions')
    expect(wrap).not.toBeNull()
    // Chip + rest must be siblings under one inline wrapper (not stacked headers).
    const chip = wrap!.querySelector('[data-mention-kind="collab"]')
    const rest = wrap!.querySelector('.user-text-rest')
    expect(chip).not.toBeNull()
    expect(chip).toHaveTextContent('Agents Collaboration')
    expect(rest).not.toBeNull()
    expect(rest).toHaveTextContent(body)
    // Normal user bubble (right-aligned), not collab mailbox / initial-task chrome.
    expect(container.querySelector('.justify-end')).not.toBeNull()
    expect(screen.queryByText('Agent task')).toBeNull()
  })

  it('renders session chip with title, not raw sessionId', () => {
    const sid = 'a9382a53-7d35-4a01-9e13-411bcbc8e850'
    const text =
      `<superone-session><title>用这个session测试一下</title><sessionId>${sid}</sessionId></superone-session> 看下工具`
    const { container } = render(
      <ChatMessage message={createUserMessage(text)} sessionStatus="idle" isLastAssistant={false} />,
    )
    const chip = container.querySelector('[data-mention-kind="session"]')
    expect(chip).not.toBeNull()
    expect(chip).toHaveTextContent('用这个session测试一下')
    expect(chip).not.toHaveTextContent(sid)
  })
})

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

describe('isRedundantTurnSummaryMarker', () => {
  it('is true when an assistant already has the same metadata.turnSummary', () => {
    expect(isRedundantTurnSummaryMarker(
      { kind: 'summary', text: 'parser race fixed' },
      [
        createClaudeMessage([{ type: 'text', text: 'done' }]),
        {
          ...createClaudeMessage([{ type: 'text', text: 'ok' }]),
          id: 'a2',
          metadata: { turnSummary: 'parser race fixed' },
        },
      ],
    )).toBe(true)
  })

  it('is false when no assistant carries that turnSummary', () => {
    expect(isRedundantTurnSummaryMarker(
      { kind: 'summary', text: 'orphan only' },
      [createClaudeMessage([{ type: 'text', text: 'done' }])],
    )).toBe(false)
  })

  it('never treats recap markers as redundant', () => {
    expect(isRedundantTurnSummaryMarker(
      { kind: 'recap', text: 'You fixed the parser.', auto: true },
      [{
        ...createClaudeMessage([{ type: 'text', text: 'ok' }]),
        metadata: { turnSummary: 'You fixed the parser.' },
      }],
    )).toBe(false)
  })
})

describe('ChatMessage compact process header', () => {
  it('shows tool, file, and line stats on the collapsed Detail disclosure', () => {
    useAppStore.setState({ detailChatMode: false })
    render(
      <ChatMessage
        message={createClaudeMessage([
          { type: 'thinking', thinking: 'plan the edit' },
          { type: 'tool_use', toolName: 'Read', toolUseId: 'r1', input: '{"file_path":"a.ts"}' },
          { type: 'tool_result', toolUseId: 'r1', summary: 'ok' },
          {
            type: 'tool_use',
            toolName: 'Edit',
            toolUseId: 'e1',
            input: '{"file_path":"a.ts","old_string":"a\\nb","new_string":"c\\nd\\ne"}',
          },
          { type: 'tool_result', toolUseId: 'e1', summary: 'ok' },
          {
            type: 'tool_use',
            toolName: 'Write',
            toolUseId: 'w1',
            input: '{"file_path":"b.ts","content":"one\\ntwo"}',
          },
          { type: 'tool_result', toolUseId: 'w1', summary: 'ok' },
          { type: 'text', text: 'All done.' },
        ])}
        sessionStatus="idle"
        isLastAssistant
      />,
    )

    expect(screen.getByText('Detail')).toBeTruthy()
    expect(screen.getByTitle('3 tool calls')).toBeTruthy()
    expect(screen.getByTitle('2 files changed')).toBeTruthy()
    expect(screen.getByText('+5')).toBeTruthy()
    expect(screen.getByText('-2')).toBeTruthy()
    expect(screen.getByText('All done.')).toBeTruthy()
  })
})
