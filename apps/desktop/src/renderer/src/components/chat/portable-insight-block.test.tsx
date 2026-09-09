/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import { applyContentDelta } from '@superone/shared/content-delta'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { splitTextIntoBlocks } from '@/../../main/split-text-blocks'

/**
 * Insight callouts take a different route to the phone than to the desktop. Desktop
 * chat keeps the `★ … ───` marker lines inside the turn's text and splits them at
 * render time; the remote projection splits them in the main process and ships an
 * `insight` block, so the markers never reach a markdown renderer that would find
 * them. The block therefore has to be rendered as a block — which is exactly what
 * was missing, and why an insight arrived on the phone as nothing at all.
 *
 * The turn is built by running the real `splitTextIntoBlocks` through the real
 * reducer: a hand-written `insight` block would pass even if the projection stopped
 * emitting one.
 */
const TURN_TEXT = [
  'Here is what I found.',
  '',
  '`★ Insight ─────────────────────────────────────`',
  '- The reducer keeps the block, the renderer dropped it.',
  '- Both halves ship from the same union now.',
  '`─────────────────────────────────────────────────`',
  '',
  'Fixing it next.',
].join('\n')

function insightTurn(text = TURN_TEXT): ChatMessage {
  const { segments } = splitTextIntoBlocks(text)
  const content = segments.reduce<ContentBlock[]>(
    (acc, seg) => applyContentDelta(acc, seg.type === 'insight'
      ? { type: 'insight', title: seg.title!, content: seg.content! }
      : { type: 'text', text: seg.text }),
    [],
  )
  return {
    id: 'turn-1',
    role: 'assistant',
    status: 'complete',
    createdAt: '2026-01-01T00:00:00.000Z',
    providerId: 'claude',
    content,
  } as ChatMessage
}

function renderTurn(message: ChatMessage) {
  return render(
    <PortableMessage
      message={message}
      scheme="dark"
      pendingPermission={null}
      isLastAssistant
      sessionStreaming={false}
    />,
  )
}

describe('insight block on the phone', () => {
  it('splits the turn into text, insight, text — the projection the phone receives', () => {
    const { segments } = splitTextIntoBlocks(TURN_TEXT)
    expect(segments.map((s) => s.type)).toEqual(['text', 'insight', 'text'])
    expect(segments[1].title).toBe('Insight')
  })

  it('keeps the insight block through the reducer instead of folding it into text', () => {
    const content = insightTurn().content
    expect(content.map((b) => b.type)).toEqual(['text', 'insight', 'text'])
  })

  it('renders the callout with its title and body', () => {
    const { container } = renderTurn(insightTurn())

    expect(container.textContent).toContain('Insight')
    expect(container.textContent).toContain('The reducer keeps the block, the renderer dropped it.')
    expect(container.textContent).toContain('Both halves ship from the same union now.')
  })

  it('draws the callout as a card, not as raw marker lines', () => {
    const { container } = renderTurn(insightTurn())

    expect(container.querySelector('.bg-insight-bg')).not.toBeNull()
    // The `─` runs are chrome the card replaces; leaking one means the block fell
    // through to the plain text renderer.
    expect(container.textContent).not.toContain('─────')
  })

  it('still renders the prose on both sides of the callout', () => {
    const { container } = renderTurn(insightTurn())

    expect(container.textContent).toContain('Here is what I found.')
    expect(container.textContent).toContain('Fixing it next.')
  })
})
