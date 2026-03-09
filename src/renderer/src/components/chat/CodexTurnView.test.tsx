/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../../../shared/agent-types'
import { CodexTurnView } from './CodexTurnView'

vi.mock('streamdown', () => ({
  Streamdown: ({ children, className }: { children: string; className?: string }) => <div className={className}>{children}</div>,
}))

vi.mock('./chat-shared', () => ({
  streamdownPlugins: [],
  streamdownControls: {},
  streamdownComponents: {},
  streamdownLinkSafety: undefined,
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

  it('still shows reasoning items from codex', () => {
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

    expect(screen.getByText('Thinking')).toBeTruthy()
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
})
