/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage as ChatMessageType } from '@superone/shared/agent-types'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { CodexRealtimeTranscript, realtimeSegmentToChatMessage } from './CodexRealtimeTranscript'

vi.mock('./ChatMessage', () => ({
  ChatMessage: ({ message, hideFooter }: { message: ChatMessageType; hideFooter?: boolean }) => (
    <div data-testid={`realtime-${message.role}`} data-hide-footer={String(Boolean(hideFooter))}>
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
    expect(window.agent.getRealtimeTimeline).toHaveBeenCalledWith('/repo', 'session-a')
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
