/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../../../shared/agent-types'
import { CodexTurnView } from './CodexTurnView'

vi.mock('./CopyableMarkdown', () => ({
  CopyableMarkdown: ({ text }: { text: string }) => <div>{text}</div>,
}))

vi.mock('./ToolBlock', () => ({
  ToolBlock: ({ toolName }: { toolName: string }) => <div>{toolName}</div>,
  FileChip: ({ name }: { name: string }) => <div>{name}</div>,
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

  it('collapses codex reasoning summary content after completion by default', () => {
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
                  id: 'reasoning-1',
                  type: 'reasoning',
                  text: 'working',
                },
              ],
            },
          },
        })}
        isStreaming={false}
      />,
    )

    expect(screen.getByText('Thought')).toBeTruthy()
    expect(screen.queryByText('working')).toBeNull()

    fireEvent.click(screen.getByText('Thought'))

    expect(screen.getByText('working')).toBeTruthy()
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

  it('does not auto expand a streaming read block', () => {
    render(
      <CodexTurnView
        message={createMessage({
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [
                {
                  id: 'cmd-1',
                  type: 'command_execution',
                  command: 'cat src/file.ts',
                  aggregatedOutput: 'file content',
                  status: 'in_progress',
                  commandActions: [{ type: 'read', path: '/test/src/file.ts' }],
                },
              ],
            },
          },
        })}
        isStreaming
      />,
    )

    expect(screen.getByText('Reading…')).toBeTruthy()
    expect(screen.queryByText(/cat src\/file\.ts/)).toBeNull()

    fireEvent.click(screen.getByText('Reading…'))

    expect(screen.getByText(/cat src\/file\.ts/)).toBeTruthy()
  })

  it('auto expands grouped streaming read and search blocks and keeps them open after completion', () => {
    const message = createMessage({
      metadata: {
        codex: {
          threadId: 'thread-1',
          usage: null,
          items: [
            {
              id: 'cmd-1',
              type: 'command_execution',
              command: 'cat src/file.ts',
              aggregatedOutput: 'file content',
              status: 'in_progress',
              commandActions: [{ type: 'read', path: '/test/src/file.ts' }],
            },
            {
              id: 'cmd-2',
              type: 'command_execution',
              command: 'rg hello src',
              aggregatedOutput: 'src/file.ts:1:hello',
              status: 'in_progress',
              commandActions: [{ type: 'search', query: 'hello', path: '/test/src' }],
            },
          ],
        },
      },
    })
    const { rerender } = render(
      <CodexTurnView
        message={message}
        isStreaming
      />,
    )

    expect(screen.getByText('hello in /test/src')).toBeTruthy()
    expect(screen.getByText('file.ts')).toBeTruthy()

    rerender(
      <CodexTurnView
        message={createMessage({
          ...message,
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [
                {
                  id: 'cmd-1',
                  type: 'command_execution',
                  command: 'cat src/file.ts',
                  aggregatedOutput: 'file content',
                  status: 'completed',
                  commandActions: [{ type: 'read', path: '/test/src/file.ts' }],
                },
                {
                  id: 'cmd-2',
                  type: 'command_execution',
                  command: 'rg hello src',
                  aggregatedOutput: 'src/file.ts:1:hello',
                  status: 'completed',
                  commandActions: [{ type: 'search', query: 'hello', path: '/test/src' }],
                },
              ],
            },
          },
        })}
        isStreaming={false}
      />,
    )

    expect(screen.getByText('Read 1 file, searched 1 code')).toBeTruthy()
    expect(screen.getByText('hello in /test/src')).toBeTruthy()
    expect(screen.getByText('file.ts')).toBeTruthy()
  })

  it('renders plan item as Plan block, not as reasoning', () => {
    render(
      <CodexTurnView
        message={createMessage({
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [
                {
                  id: 'plan-1',
                  type: 'plan',
                  text: '## Step 1\nDo something',
                },
              ],
            },
          },
        })}
        isStreaming
      />,
    )

    expect(screen.getByText('Plan')).toBeTruthy()
    expect(screen.queryByText('Thinking...')).toBeNull()
  })

  it('does not show fallback text when plan items exist', () => {
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          content: [{ type: 'text', text: 'Codex completed without returning text.' }],
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [
                {
                  id: 'plan-1',
                  type: 'plan',
                  text: '## My plan',
                },
              ],
            },
          },
        })}
        isStreaming={false}
      />,
    )

    expect(screen.getByText('Plan')).toBeTruthy()
    expect(screen.queryByText('Codex completed without returning text.')).toBeNull()
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
