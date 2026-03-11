/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../../../shared/agent-types'
import { CodexTurnView } from './CodexTurnView'

vi.mock('./CopyableMarkdown', () => ({
  CopyableMarkdown: ({ text }: { text: string }) => <div>{text}</div>,
}))

vi.mock('./ToolBlock', () => ({
  ToolBlock: ({ toolName }: { toolName: string }) => <div>{toolName}</div>,
}))

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    status: 'streaming',
    content: [],
    createdAt: '2026-03-09T00:00:00.000Z',
    providerId: 'codex',
    ...overrides,
  }
}

describe('CodexTurnView', () => {
  it('does not show thinking placeholder before the first codex item arrives', () => {
    render(<CodexTurnView message={createMessage()} isStreaming />)

    expect(screen.queryByText('Thinking')).toBeNull()
  })

  it('does not show thinking placeholder when codex metadata exists but items are still empty', () => {
    render(
      <CodexTurnView
        message={createMessage({
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [],
            },
          },
        })}
        isStreaming
      />,
    )

    expect(screen.queryByText('Thinking')).toBeNull()
  })

  it('shows codex reasoning as a status indicator only', () => {
    render(
      <CodexTurnView
        message={createMessage({
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [
                {
                  id: 'reasoning-1',
                  type: 'reasoning',
                  text: 'working',
                },
              ],
            },
          },
        })}
        isStreaming
      />,
    )

    expect(screen.getByText('Thinking...')).toBeTruthy()
    expect(screen.queryByText('working')).toBeNull()
  })

  it('renders recent codex text immediately when not streaming', () => {
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          createdAt: new Date().toISOString(),
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [
                {
                  id: 'agent-1',
                  type: 'agent_message',
                  text: 'done',
                },
              ],
            },
          },
        })}
        isStreaming={false}
      />,
    )

    expect(screen.getByText('done')).toBeTruthy()
  })

  it('does not render codex todo lists inline', () => {
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [
                {
                  id: 'todo-1',
                  type: 'todo_list',
                  items: [
                    { text: 'first task', completed: false },
                    { text: 'second task', completed: true },
                  ],
                },
              ],
            },
          },
        })}
        isStreaming={false}
      />,
    )

    expect(screen.queryByText('Todos (1/2)')).toBeNull()
    expect(screen.queryByText('first task')).toBeNull()
    expect(screen.queryByText('second task')).toBeNull()
  })
})
