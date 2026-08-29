/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { CodexConversationViewToggle } from './CodexConversationViewToggle'

describe('CodexConversationViewToggle', () => {
  const getRealtimeTimeline = vi.fn()

  beforeEach(() => {
    useCodexRealtimeViewStore.setState({ sessions: {} })
    getRealtimeTimeline.mockReset()
    getRealtimeTimeline.mockResolvedValue({
      segments: [],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: false,
    })
    Object.defineProperty(window, 'agent', {
      configurable: true,
      value: { getRealtimeTimeline },
    })
  })

  it('toggles the active Codex session between thread and realtime views', () => {
    useCodexRealtimeViewStore.getState().setTimeline('session-a', {
      segments: [],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    })
    render(
      <CodexConversationViewToggle
        projectPath="/repo"
        sessionId="session-a"
        providerSessionId="thread-a"
        enabled
      />,
    )

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(button)

    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button.querySelector('.lucide-message-square')).not.toBeNull()
    expect(useCodexRealtimeViewStore.getState().sessions['session-a']?.view).toBe('realtime')
  })

  it('does not render for non-Codex sessions', () => {
    render(
      <CodexConversationViewToggle
        projectPath="/repo"
        sessionId="session-a"
        providerSessionId="thread-a"
        enabled={false}
      />,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('does not show the voice timeline action before a timeline exists', () => {
    render(
      <CodexConversationViewToggle
        projectPath="/repo"
        sessionId="session-a"
        providerSessionId={null}
        enabled
      />,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows the action after discovering timeline history for an existing Codex thread', async () => {
    getRealtimeTimeline.mockResolvedValue({
      segments: [],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    })
    render(
      <CodexConversationViewToggle
        projectPath="/repo"
        sessionId="session-a"
        providerSessionId="thread-a"
        enabled
      />,
    )

    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument())
    expect(getRealtimeTimeline).toHaveBeenCalledWith('/repo', 'session-a')
  })
})
