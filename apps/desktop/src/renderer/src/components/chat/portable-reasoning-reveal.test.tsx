/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import { applyContentDelta } from '@superone/shared/content-delta'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'

/** Completed reasoning stays collapsed while the current block receives deltas. */
function reasoningTurn(): ChatMessage {
  const startedAt = Date.now() - 9_000
  const content = [
    { type: 'thinking', thinking: 'earlier reasoning', startedAt, endedAt: startedAt + 4_000 } as ContentBlock,
    { type: 'text', text: 'Checking the tree.' } as ContentBlock,
    { type: 'thinking', thinking: 'current reasoning', startedAt: startedAt + 5_000 } as ContentBlock,
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

  it('keeps the current reasoning block open', () => {
    const { container } = renderTurn()

    expect(container.textContent).toContain('current reasoning')
  })

  it('matches the settled turn, where only the live block is open', () => {
    const { container } = renderTurn()

    expect(container.textContent).not.toContain('earlier reasoning')
    expect(container.textContent).toContain('current reasoning')
  })
})
