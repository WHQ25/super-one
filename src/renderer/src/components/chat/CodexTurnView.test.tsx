/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../../../shared/agent-types'
import { CodexTurnView } from './CodexTurnView'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { PlanFullscreenContext } from './codex-item-renderer'

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

const mockApproveCodexPlan = vi.fn()
const mockRejectCodexPlan = vi.fn()

function setupActiveSession(overrides: Partial<ReturnType<typeof createDefaultPerSessionState>> = {}) {
  const project = createDefaultProjectState()
  const session: ReturnType<typeof createDefaultPerSessionState> = {
    ...createDefaultPerSessionState(),
    selectedCodexCollaborationMode: 'default',
    ...overrides,
  }
  useChatStore.setState({
    activeProject: '/test',
    approveCodexPlan: mockApproveCodexPlan,
    rejectCodexPlan: mockRejectCodexPlan,
    projectSessions: {
      '/test': {
        ...project,
        _activeSessionId: 'sid-1',
        hasPendingInteraction: false,
        _sessions: {
          'sid-1': session,
        },
      },
    },
  })
}

beforeEach(() => {
  mockApproveCodexPlan.mockReset()
  mockRejectCodexPlan.mockReset()
  useChatStore.setState({
    activeProject: null,
    projectSessions: {},
    approveCodexPlan: mockApproveCodexPlan,
    rejectCodexPlan: mockRejectCodexPlan,
  })
})

describe('CodexTurnView', () => {
  it('does not show thinking placeholder before the first codex item arrives', () => {
    render(<CodexTurnView message={createMessage()} isStreaming isLastAssistant />)

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
        isLastAssistant
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
        isLastAssistant
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
        isLastAssistant
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
        isLastAssistant
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
        isLastAssistant
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
        isLastAssistant
      />,
    )

    expect(screen.getByText('Read 1 file, searched 1 code')).toBeTruthy()
    expect(screen.getByText('hello in /test/src')).toBeTruthy()
    expect(screen.getByText('file.ts')).toBeTruthy()
  })

  it('renders plan item as Plan block, not as reasoning', () => {
    setupActiveSession({ selectedCodexCollaborationMode: 'plan' })
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
        isLastAssistant
      />,
    )

    expect(screen.getByText('Plan')).toBeTruthy()
    expect(screen.queryByText('Thinking...')).toBeNull()
  })

  it('does not show fallback text when plan items exist', () => {
    setupActiveSession({ selectedCodexCollaborationMode: 'plan' })
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
        isLastAssistant
      />,
    )

    expect(screen.getByText('Plan')).toBeTruthy()
    expect(screen.queryByText('Codex completed without returning text.')).toBeNull()
  })

  it('does not render codex todo lists inline', () => {
    setupActiveSession()
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
        isLastAssistant
      />,
    )

    expect(screen.queryByText('Todos (1/2)')).toBeNull()
    expect(screen.queryByText('first task')).toBeNull()
    expect(screen.queryByText('second task')).toBeNull()
  })

  it('shows Approve and Reject only after expanding the latest completed plan in plan mode', () => {
    setupActiveSession({ selectedCodexCollaborationMode: 'plan' })
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
                  id: 'plan-1',
                  type: 'plan',
                  text: '## My plan',
                },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.queryByText('Reject')).toBeNull()

    fireEvent.click(screen.getByText('Plan'))
    fireEvent.click(screen.getByText('Approve'))

    expect(mockApproveCodexPlan).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.queryByText('Reject')).toBeNull()
  })

  it('passes approve and reject callbacks into plan fullscreen for the latest plan', () => {
    setupActiveSession({ selectedCodexCollaborationMode: 'plan' })
    const open = vi.fn()
    render(
      <PlanFullscreenContext.Provider value={{ open }}>
        <CodexTurnView
          message={createMessage({
            status: 'complete',
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
          isLastAssistant
        />
      </PlanFullscreenContext.Provider>,
    )

    fireEvent.click(screen.getByText('Plan'))
    fireEvent.click(screen.getByTitle('Fullscreen'))

    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0]?.[0]).toBe('## My plan')
    expect(open.mock.calls[0]?.[1]).toEqual({
      onApprove: mockApproveCodexPlan,
      onReject: mockRejectCodexPlan,
      planApproval: undefined,
    })
  })

  it('hides Approve and Reject outside plan mode', () => {
    setupActiveSession({ selectedCodexCollaborationMode: 'default' })
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
                  id: 'plan-1',
                  type: 'plan',
                  text: '## My plan',
                },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    fireEvent.click(screen.getByText('Plan'))

    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.queryByText('Reject')).toBeNull()
  })

  it('passes footer feedback into reject action', () => {
    setupActiveSession({ selectedCodexCollaborationMode: 'plan' })
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
                  id: 'plan-1',
                  type: 'plan',
                  text: '## My plan',
                },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    fireEvent.click(screen.getByText('Plan'))
    fireEvent.change(screen.getByPlaceholderText('Reject feedback (optional, Enter to submit)'), {
      target: { value: 'Only touch the renderer layer.' },
    })
    fireEvent.click(screen.getByText('Reject'))

    expect(mockRejectCodexPlan).toHaveBeenCalledWith('Only touch the renderer layer.')
  })

  it('rejects without feedback when the footer input is empty', () => {
    setupActiveSession({ selectedCodexCollaborationMode: 'plan' })
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
                  id: 'plan-1',
                  type: 'plan',
                  text: '## My plan',
                },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    fireEvent.click(screen.getByText('Plan'))
    fireEvent.click(screen.getByText('Reject'))

    expect(mockRejectCodexPlan).toHaveBeenCalledWith(undefined)
  })

  it('renders persisted rejected state for a reviewed plan', () => {
    setupActiveSession({ selectedCodexCollaborationMode: 'default' })
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              planApproval: { status: 'rejected', feedback: 'Only update the renderer.' },
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
        isLastAssistant={false}
      />,
    )

    expect(screen.getByText('Rejected')).toBeTruthy()
    expect(screen.getByText('Only update the renderer.')).toBeTruthy()
    fireEvent.click(screen.getByText('Plan'))
    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.queryByText('Reject')).toBeNull()
  })
})
