/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage as ChatMessageType } from '@superone/shared/agent-types'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { CodexRealtimeTranscript, realtimeSegmentToChatMessage } from './CodexRealtimeTranscript'

vi.mock('./ChatMessage', () => ({
  ChatMessage: ({ message, hideFooter, compactSpacing }: { message: ChatMessageType; hideFooter?: boolean; compactSpacing?: boolean }) => (
    <div
      data-testid={`realtime-${message.role}`}
      data-hide-footer={String(Boolean(hideFooter))}
      data-compact-spacing={String(Boolean(compactSpacing))}
    >
      {message.content.map((block) => block.type === 'text' ? block.text : '').join('')}
    </div>
  ),
}))

vi.mock('./SelectionContextMenu', () => ({
  SelectionContextMenuZone: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}))

describe('CodexRealtimeTranscript', () => {
  beforeEach(() => {
    useCodexRealtimeViewStore.setState({ sessions: {} })
    Object.defineProperty(window, 'agent', {
      configurable: true,
      value: {
        getRealtimeTimeline: vi.fn(async () => ({
          activeRealtimeSessionId: null,
          hasTimeline: true,
          threadMessages: [],
          segments: [
            {
              id: 'segment-1',
              realtimeSessionId: 'realtime-1',
              role: 'user',
              text: 'Please inspect the logs.',
            },
            {
              id: 'segment-2',
              realtimeSessionId: 'realtime-1',
              role: 'assistant',
              text: 'I will check them now.',
            },
          ],
        })),
      },
    })
  })

  it('loads and renders transcript segments for the selected session', async () => {
    render(
      <CodexRealtimeTranscript
        projectPath="/repo"
        sessionId="session-a"
        scrollViewportRef={{ current: null }}
        liquidGlass
      />,
    )

    expect(await screen.findByText('Please inspect the logs.')).toBeInTheDocument()
    expect(screen.getByText('I will check them now.')).toBeInTheDocument()
    expect(screen.getByTestId('realtime-assistant')).toHaveAttribute('data-hide-footer', 'true')
    expect(screen.getByTestId('realtime-assistant')).toHaveAttribute('data-compact-spacing', 'true')
    expect(window.agent.getRealtimeTimeline).toHaveBeenCalledWith('/repo', 'session-a')
  })

  it('renders a live call in the order each speaker started, not the order they finished', async () => {
    const store = useCodexRealtimeViewStore.getState()
    store.setRealtimeSession('session-a', 'realtime-1')
    store.startTranscriptItem('session-a', {
      itemId: 'user-1', realtimeSessionId: 'realtime-1', role: 'user', text: '',
    })
    store.appendTranscriptItemDelta('session-a', 'user-1', 'Read the file')
    store.startTranscriptItem('session-a', {
      itemId: 'assistant-1', realtimeSessionId: 'realtime-1', role: 'assistant', text: '',
    })
    store.appendTranscriptItemDelta('session-a', 'assistant-1', 'On it')
    store.completeTranscriptItem('session-a', {
      itemId: 'assistant-1', realtimeSessionId: 'realtime-1', role: 'assistant', text: 'On it.',
    })

    render(
      <CodexRealtimeTranscript
        projectPath="/repo"
        sessionId="session-a"
        scrollViewportRef={{ current: null }}
        liquidGlass
      />,
    )

    await screen.findByText('Please inspect the logs.')
    const rendered = screen.getAllByTestId(/^realtime-/).map((node) => node.textContent)
    expect(rendered.slice(-2)).toEqual(['Read the file', 'On it.'])
  })

  it('maps realtime segments onto the normal Codex chat message shape', () => {
    expect(realtimeSegmentToChatMessage({
      id: 'segment-1',
      realtimeSessionId: 'realtime-1',
      role: 'assistant',
      text: '**Done**',
    })).toMatchObject({
      role: 'assistant',
      status: 'complete',
      providerId: 'codex',
      content: [{ type: 'text', text: '**Done**' }],
    })
  })
})
