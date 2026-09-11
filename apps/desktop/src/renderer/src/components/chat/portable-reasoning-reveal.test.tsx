/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import { applyContentDelta } from '@superone/shared/content-delta'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'

/**
 * Mobile reasoning is deferred: a live block starts collapsed so a growing
 * thought stream never opens a detail subscription on its own, and only a
 * manual tap reveals it. Completed reasoning stays collapsed as on desktop.
 */
function reasoningTurn(currentThinking = 'current reasoning'): ChatMessage {
  const startedAt = Date.now() - 9_000
  const content = [
    { type: 'thinking', thinking: 'earlier reasoning', startedAt, endedAt: startedAt + 4_000 } as ContentBlock,
    { type: 'text', text: 'Checking the tree.' } as ContentBlock,
    { type: 'thinking', thinking: currentThinking, startedAt: startedAt + 5_000 } as ContentBlock,
  ].reduce<ContentBlock[]>((acc, block) => applyContentDelta(acc, block), [])

  return {
    id: 'turn-1',
    role: 'assistant',
    status: 'streaming',
    createdAt: '2026-01-01T00:00:00.000Z',
    providerId: 'claude',
    content,
  } as ChatMessage
}

function renderTurn() {
  return render(
    <PortableMessage
      message={reasoningTurn()}
      scheme="dark"
      pendingPermission={null}
      isLastAssistant
      sessionStreaming
    />,
  )
}

describe('reasoning blocks during live streaming', () => {
  it('leaves a finished reasoning block collapsed', () => {
    const { container } = renderTurn()

    expect(container.textContent).not.toContain('earlier reasoning')
  })

  it('starts the current reasoning block collapsed', () => {
    const { container } = renderTurn()

    expect(container.textContent).not.toContain('current reasoning')
  })

  it('reveals the current reasoning block on tap and keeps it open across deltas', () => {
    const { container, rerender } = renderTurn()

    fireEvent.click(screen.getByText(/^Thinking/))
    expect(container.textContent).toContain('current reasoning')

    rerender(
      <PortableMessage
        message={reasoningTurn('current reasoning, continued')}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming
      />,
    )
    expect(container.textContent).toContain('current reasoning, continued')
    expect(container.textContent).not.toContain('earlier reasoning')
  })
})
