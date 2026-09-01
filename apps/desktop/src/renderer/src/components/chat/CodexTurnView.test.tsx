/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { CodexTurnView } from './CodexTurnView'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useMiniAppStore } from '@/stores/miniapp'
import { PlanFullscreenContext } from './codex-item-renderer'

vi.mock('./CopyableMarkdown', () => ({
  CopyableMarkdown: ({ text }: { text: string }) => <div>{text}</div>,
}))

vi.mock('./ToolBlock', () => ({
  ToolBlock: ({ toolName, isError }: { toolName: string; isError?: boolean }) => (
    <div data-testid={`tool-${toolName}`} data-error={isError ? 'true' : 'false'}>{toolName}</div>
  ),
  FileChip: ({ name }: { name: string }) => <div>{name}</div>,
}))

vi.mock('./ImageGalleryBlock', () => ({
  ImageGalleryBlock: ({ items }: { items: Array<{ id: string }> }) => (
    <div data-testid="gallery">gallery:{items.length}</div>
  ),
}))

vi.mock('./CodexImageGenerationBlock', () => ({
  CodexImageGenerationBlock: ({ item }: { item: { id: string } }) => (
    <div data-testid="single">single:{item.id}</div>
  ),
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
  // Tests assert full process content; opt into Detail Mode so compact default doesn't hide it.
  useAppStore.setState({ detailChatMode: true })
  useMiniAppStore.setState({ apps: [] })
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

  it('collapses the entire delegated turn including the agent response by default', () => {
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
                  id: 'lookup-1',
                  type: 'mcp_tool_call',
                  server: 'example',
                  tool: 'lookup',
                  arguments: { query: 'auth' },
                  status: 'completed',
                },
                { id: 'agent-1', type: 'agent_message', text: 'Full agent response' },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
        collapseEntireTurn
        footer={<div>Turn footer</div>}
      />,
    )

    expect(screen.getByRole('button', { name: /Detail/ })).toBeTruthy()
    expect(screen.queryByTestId('tool-mcp__example__lookup')).toBeNull()
    expect(screen.queryByText('Full agent response')).toBeNull()
    expect(screen.queryByText('Turn footer')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Detail/ }))

    expect(screen.getByTestId('tool-mcp__example__lookup')).toBeTruthy()
    expect(screen.getByText('Full agent response')).toBeTruthy()
    expect(screen.getByText('Turn footer')).toBeTruthy()
  })

  it('keeps terminal Codex error logs out of the turn body', () => {
    render(
      <CodexTurnView
        message={createMessage({
          status: 'error',
          metadata: {
            errorInfo: { raw: 'accumulated stderr log' },
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [
                { id: 'error-1', type: 'error', message: 'accumulated stderr log' },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    expect(screen.queryByText('accumulated stderr log')).toBeNull()
  })

  it('keeps non-terminal Codex error items visible', () => {
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [
                { id: 'error-1', type: 'error', message: 'strict review required' },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    expect(screen.getByText('strict review required')).toBeTruthy()
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

  it('merges consecutive codex reasoning items into one block', () => {
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [
                { id: 'reasoning-1', type: 'reasoning', text: 'first thought' },
                { id: 'reasoning-2', type: 'reasoning', text: 'second thought' },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    expect(screen.getAllByText('Thought')).toHaveLength(1)

    fireEvent.click(screen.getByText('Thought'))

    expect(screen.getByText(/first thought\s+second thought/)).toBeTruthy()
  })

  it('merges reasoning items separated only by invisible codex items', () => {
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [
                { id: 'reasoning-1', type: 'reasoning', text: 'first thought' },
                { id: 'todo-1', type: 'todo_list', items: [] },
                {
                  id: 'wait-1',
                  type: 'collab_tool_call',
                  tool: 'wait',
                  status: 'completed',
                  receiverThreadIds: [],
                  agentsStates: {},
                },
                { id: 'reasoning-2', type: 'reasoning', text: 'second thought' },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    expect(screen.getAllByText('Thought')).toHaveLength(1)

    fireEvent.click(screen.getByText('Thought'))

    expect(screen.getByText(/first thought\s+second thought/)).toBeTruthy()
  })

  it('merges reasoning items separated by a hidden MCP tool', () => {
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [
                { id: 'reasoning-1', type: 'reasoning', text: 'first thought' },
                {
                  id: 'rename-1',
                  type: 'mcp_tool_call',
                  server: 'superone',
                  tool: 'session_rename',
                  arguments: { title: 'Renamed session' },
                  status: 'completed',
                },
                { id: 'reasoning-2', type: 'reasoning', text: 'second thought' },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    expect(screen.getAllByText('Thought')).toHaveLength(1)
  })

  it('keeps codex reasoning items separate across visible content', () => {
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [
                { id: 'reasoning-1', type: 'reasoning', text: 'first thought' },
                { id: 'agent-1', type: 'agent_message', text: 'visible answer' },
                { id: 'reasoning-2', type: 'reasoning', text: 'second thought' },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    expect(screen.getAllByText('Thought')).toHaveLength(2)
    expect(screen.getByText('visible answer')).toBeTruthy()
  })

  it('renders empty codex reasoning as a non-expandable status block', () => {
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
                  text: '',
                },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    const label = screen.getByText('Thought')

    expect(label).toBeTruthy()
    expect(label.parentElement?.className).not.toContain('cursor-pointer')
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

    expect(screen.getByText('file.ts')).toBeTruthy()
    expect(screen.getByText('Reading…')).toBeTruthy()
    expect(screen.queryByText(/cat src\/file\.ts/)).toBeNull()

    fireEvent.click(screen.getByText('Reading…'))

    expect(screen.getByText('file.ts')).toBeTruthy()
    expect(screen.getByText(/cat src\/file\.ts/)).toBeTruthy()
  })

  it('uses the shared terminal spacing for expanded Bash commands', () => {
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
                  command: 'bun run test',
                  aggregatedOutput: 'line one\nline two',
                  status: 'completed',
                },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    fireEvent.click(screen.getByText('Bash'))

    expect(screen.getByText(/line one/).parentElement).toHaveClass('max-h-72', 'overflow-y-auto')
    expect(screen.getByText(/bun run test/)).toHaveClass('line-clamp-3')
  })

  it('renders a non-zero command exit as a normal tool call outcome', () => {
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [{
                id: 'cmd-failed',
                type: 'command_execution',
                command: 'bun run test',
                aggregatedOutput: 'FAIL src/example.test.ts',
                exitCode: 1,
                status: 'failed',
              }],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    const row = screen.getByText('Bash').closest('.tool-node')
    expect(row).not.toHaveClass('errored', 'bg-warning/10')
    expect(screen.queryByText('Error')).toBeNull()

    fireEvent.click(screen.getByText('Bash'))
    expect(screen.getByText(/FAIL src\/example\.test\.ts/)).toBeTruthy()
    expect(screen.getByText(/Exit code 1/)).toBeTruthy()
  })

  it('keeps warning chrome for a command tool failure without an exit code', () => {
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [{
                id: 'cmd-error',
                type: 'command_execution',
                command: 'bun run test',
                aggregatedOutput: 'Failed to start command process',
                status: 'failed',
              }],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    const row = screen.getByText('Bash').closest('.tool-node')
    expect(row).toHaveClass('errored', 'bg-warning/10')
    expect(screen.getByText('Error')).toBeTruthy()
  })

  it('keeps a grep no-match result neutral in a collapsed command group', () => {
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
                  id: 'grep-no-match',
                  type: 'command_execution',
                  command: 'rg missing src',
                  aggregatedOutput: '',
                  exitCode: 1,
                  status: 'failed',
                  commandActions: [{ type: 'search', query: 'missing', path: '/test/src' }],
                },
                {
                  id: 'read-after-grep',
                  type: 'command_execution',
                  command: 'cat src/example.ts',
                  aggregatedOutput: 'export {}',
                  exitCode: 0,
                  status: 'completed',
                  commandActions: [{ type: 'read', path: '/test/src/example.ts' }],
                },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    const groupHeader = screen.getByRole('button', { name: /Read 1 file, searched 1 code/ })
    expect(groupHeader).toHaveClass('bg-muted/50')
    expect(groupHeader).not.toHaveClass('tool-node', 'errored', 'bg-warning/10')
    expect(screen.queryByText('Error')).toBeNull()
  })

  it('keeps a mini-app tool group on the lightweight group header', () => {
    useMiniAppStore.setState({
      apps: [{
        id: 'project-tools',
        installDir: '/test/project-tools',
        manifest: {
          appId: 'project-tools',
          name: 'Project Tools',
          main: 'node.js',
          tools: [
            { name: 'find_files', description: '', inputSchema: {}, groupable: true },
            { name: 'inspect_file', description: '', inputSchema: {}, groupable: true },
          ],
        },
      }],
    })

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
                  id: 'find-files',
                  type: 'mcp_tool_call',
                  server: 'superone',
                  tool: 'miniapp_call',
                  arguments: { appId: 'project-tools', tool: 'find_files', arguments: {} },
                  status: 'completed',
                },
                {
                  id: 'inspect-file',
                  type: 'mcp_tool_call',
                  server: 'superone',
                  tool: 'miniapp_call',
                  arguments: { appId: 'project-tools', tool: 'inspect_file', arguments: {} },
                  status: 'completed',
                },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    const groupHeader = screen.getByRole('button', { name: /Project Tools.*2 tool calls/ })
    expect(groupHeader).toHaveClass('bg-muted/50')
    expect(groupHeader).not.toHaveClass('tool-node')
  })

  it.each([
    {
      label: 'MCP call',
      item: {
        id: 'mcp-failed',
        type: 'mcp_tool_call' as const,
        server: 'example',
        tool: 'lookup',
        arguments: { query: 'auth' },
        error: { message: 'server unavailable' },
        status: 'failed' as const,
      },
      toolName: 'mcp__example__lookup',
    },
    {
      label: 'file change',
      item: {
        id: 'patch-failed',
        type: 'file_change' as const,
        changes: [{ path: '/test/src/example.ts', kind: 'update' as const }],
        status: 'failed' as const,
      },
      toolName: 'FileChange',
    },
    {
      label: 'web search',
      item: {
        id: 'search-failed',
        type: 'web_search' as const,
        query: 'SuperOne tool UI',
        status: 'failed' as const,
      },
      toolName: 'WebSearch',
    },
  ])('forwards a failed Codex $label to ToolBlock', ({ item, toolName }) => {
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [item],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    expect(screen.getByTestId(`tool-${toolName}`)).toHaveAttribute('data-error', 'true')
  })

  it('auto expands grouped streaming read and search blocks and collapses after completion', () => {
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
    expect(screen.queryByText('hello in /test/src')).toBeNull()
    expect(screen.queryByText('file.ts')).toBeNull()

    fireEvent.click(screen.getByText('Read 1 file, searched 1 code'))

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
    fireEvent.click(document.querySelector('.lucide-expand')!.closest('button')!)

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

  it('renders a worker spawnAgent as a subagent card', () => {
    setupActiveSession()
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'main-thread',
              usage: null,
              items: [
                {
                  id: 'collab-spawn-1',
                  type: 'collab_tool_call',
                  tool: 'spawnAgent',
                  status: 'completed',
                  senderThreadId: 'main-thread',
                  receiverThreadIds: ['worker-thread'],
                  prompt: 'start',
                  agentsStates: {
                    'worker-thread': {
                      status: 'completed',
                      nickname: 'Euler',
                      role: 'worker',
                    },
                  },
                },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    expect(screen.getByText('Euler')).toBeTruthy()
    expect(screen.getByText('worker')).toBeTruthy()
    expect(screen.queryByText('forked')).toBeNull()
  })

  it('renders a worker sendInput as a subagent card', () => {
    setupActiveSession()
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'main-thread',
              usage: null,
              items: [
                {
                  id: 'collab-send-1',
                  type: 'collab_tool_call',
                  tool: 'sendInput',
                  status: 'completed',
                  senderThreadId: 'main-thread',
                  receiverThreadIds: ['worker-thread'],
                  prompt: 'continue',
                  agentsStates: {
                    'worker-thread': {
                      status: 'completed',
                      nickname: 'Euler',
                      role: 'worker',
                    },
                  },
                  childItems: {
                    'worker-thread': [
                      {
                        id: 'worker-msg-1',
                        type: 'agent_message',
                        text: 'done',
                      },
                    ],
                  },
                },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    expect(screen.getByText('Euler')).toBeTruthy()
    expect(screen.getByText('worker')).toBeTruthy()
    expect(screen.queryByText('forked')).toBeNull()
    expect(screen.queryByText('Follow-up → Euler')).toBeNull()
  })

  it('renders a forked sendInput with only the forked badge', () => {
    setupActiveSession()
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'main-thread',
              usage: null,
              items: [
                {
                  id: 'collab-send-1',
                  type: 'collab_tool_call',
                  tool: 'sendInput',
                  status: 'completed',
                  senderThreadId: 'main-thread',
                  receiverThreadIds: ['fork-thread'],
                  prompt: 'continue',
                  agentsStates: {
                    'fork-thread': {
                      status: 'completed',
                      nickname: 'Euler',
                      role: 'worker',
                      forkedFromId: 'main-thread',
                    },
                  },
                },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    expect(screen.getByText('Euler')).toBeTruthy()
    expect(screen.getByText('forked')).toBeTruthy()
    expect(screen.queryByText('worker')).toBeNull()
    expect(screen.queryByText('Follow-up → Euler')).toBeNull()
  })

  it('renders a failed subagent as a non-expandable error row', () => {
    setupActiveSession()
    const { container } = render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'main-thread',
              usage: null,
              items: [
                {
                  id: 'collab-send-1',
                  type: 'collab_tool_call',
                  tool: 'sendInput',
                  status: 'failed',
                  senderThreadId: 'main-thread',
                  receiverThreadIds: ['worker-thread'],
                  prompt: 'continue',
                  agentsStates: {
                    'worker-thread': {
                      status: 'notFound',
                      nickname: 'Euler',
                      role: 'worker',
                    },
                  },
                },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    expect(screen.getByText('Euler')).toBeTruthy()
    expect(screen.getByText('worker')).toBeTruthy()
    expect(screen.getByText('Follow-up failed: Subagent is not available. Resume it, then retry this follow-up.')).toBeTruthy()
    expect(screen.getByText('Error')).toBeTruthy()
    expect(container.querySelector('button')).toBeNull()
  })

  it('collects every image of a turn into one gallery rendered after the turn content', () => {
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [
                { id: 'agent-1', type: 'agent_message', text: 'here are the renders' },
                { id: 'img-1', type: 'image_generation', status: 'completed', savedPath: '/a.png' },
                { id: 'img-2', type: 'image_generation', status: 'completed', savedPath: '/b.png' },
                { id: 'img-3', type: 'image_generation', status: 'completed', savedPath: '/c.png' },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    const gallery = screen.getByTestId('gallery')
    const text = screen.getByText('here are the renders')
    expect(gallery.textContent).toBe('gallery:3')
    expect(screen.queryByTestId('single')).toBeNull()
    expect(text.compareDocumentPosition(gallery) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders even a lone image through the gallery, never the standalone single block', () => {
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [
                { id: 'img-1', type: 'image_generation', status: 'completed', savedPath: '/a.png' },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    expect(screen.getByTestId('gallery').textContent).toBe('gallery:1')
    expect(screen.queryByTestId('single')).toBeNull()
  })

  it('merges images interleaved with other items into a single end gallery', () => {
    render(
      <CodexTurnView
        message={createMessage({
          status: 'complete',
          metadata: {
            codex: {
              threadId: 'thread-1',
              usage: null,
              items: [
                { id: 'img-1', type: 'image_generation', status: 'completed', savedPath: '/a.png' },
                { id: 'img-2', type: 'image_generation', status: 'completed', savedPath: '/b.png' },
                { id: 'agent-1', type: 'agent_message', text: 'between images' },
                { id: 'img-3', type: 'image_generation', status: 'completed', savedPath: '/c.png' },
                { id: 'img-4', type: 'image_generation', status: 'completed', savedPath: '/d.png' },
              ],
            },
          },
        })}
        isStreaming={false}
        isLastAssistant
      />,
    )

    const galleries = screen.getAllByTestId('gallery')
    expect(galleries).toHaveLength(1)
    expect(galleries[0].textContent).toBe('gallery:4')
    const text = screen.getByText('between images')
    expect(text.compareDocumentPosition(galleries[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
