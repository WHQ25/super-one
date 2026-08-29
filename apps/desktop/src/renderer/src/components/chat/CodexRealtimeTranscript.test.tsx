/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage as ChatMessageType } from '@superone/shared/agent-types'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { CodexRealtimeTranscript } from './CodexRealtimeTranscript'

vi.mock('./ChatMessage', () => ({
  ChatMessage: ({ message }: { message: ChatMessageType }) => (
    <div data-testid={`realtime-${message.role}`}>
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

  it('says it is listening rather than loading while a new call has no transcript yet', async () => {
    // A call started on a session whose timeline was never fetched: the mount kicks off
    // a hydrate, and showing "Loading..." for that beat reads as the chat blanking out.
    window.agent.getRealtimeTimeline = vi.fn(async () => ({
      activeRealtimeSessionId: 'realtime-1', hasTimeline: true, threadMessages: [], segments: [],
    }))
    useCodexRealtimeViewStore.getState().setRealtimeSession('session-a', 'realtime-1')

    render(
      <CodexRealtimeTranscript
        projectPath="/repo"
        sessionId="session-a"
        scrollViewportRef={{ current: null }}
        liquidGlass
      />,
    )

    // The very first paint, before the mount-triggered hydrate has resolved.
    expect(screen.getByText('Listening for speech…')).toBeInTheDocument()
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
    await screen.findByText('Listening for speech…')
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
    // The realtime view is the vertical timeline, not the chat message renderer.
    expect(screen.queryByTestId('realtime-assistant')).not.toBeInTheDocument()
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
    const spoken = [...document.querySelectorAll('p')].map((node) => node.textContent)
    expect(spoken.slice(-2)).toEqual(['Read the file', 'On it.'])
  })
})
