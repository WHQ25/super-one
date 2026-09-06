/** @vitest-environment jsdom */

import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'

/**
 * A tool call that stands alone in a turn — one Edit between two paragraphs — goes through
 * `ClaudeTurnBody`'s single-tool branch rather than the tool-group branch. Only the group
 * branch used to forward the precomputed edit metadata, so on the phone a lone Edit row
 * opened onto nothing: `toolDiff` never reached the presenter that draws it.
 */
function turnWithLoneEdit(): ChatMessage {
  return {
    id: 'turn-1',
    role: 'assistant',
    status: 'complete',
    createdAt: '2026-01-01T00:00:00.000Z',
    providerId: 'claude',
    content: [
      { type: 'text', text: 'Flipping the preview flag.' },
      {
        type: 'edit',
        toolName: 'Edit',
        toolUseId: 'edit-1',
        status: 'complete',
        input: JSON.stringify({ file_path: '/workspace/apps/mobile/src/config.ts' }),
        toolFilePath: 'apps/mobile/src/config.ts',
        toolDiff: '-const previewEnabled = false\n+const previewEnabled = true',
        toolLineDelta: { added: 1, removed: 1 },
      },
      { type: 'tool_result', toolUseId: 'edit-1', summary: 'Applied 1 edit.', isError: false },
    ] as ContentBlock[],
  } as ChatMessage
}

describe('portable turn tool metadata', () => {
  it('draws the diff of a tool call that is alone in its turn', () => {
    const { container } = render(
      <PortableMessage message={turnWithLoneEdit()} scheme="dark" pendingPermission={null} />,
    )

    // The header counter is the cheapest proof `toolLineDelta` survived the turn body.
    expect(within(container).getByText('+1')).toBeInTheDocument()
    expect(within(container).getByText('-1')).toBeInTheDocument()

    fireEvent.click(container.querySelector('.tool-node > div')!)
    expect(screen.getByText('const previewEnabled = true')).toBeInTheDocument()
    expect(screen.getByText('const previewEnabled = false')).toBeInTheDocument()
  })

  it('bounds the expanded diff to the desktop scroll window instead of growing the turn', () => {
    const rows: string[] = []
    for (let i = 0; i < 120; i++) rows.push(`-before ${i}`, `+after ${i}`)
    const message = turnWithLoneEdit()
    const edit = message.content[1] as ContentBlock & { toolDiff: string }
    edit.toolDiff = rows.join('\n')

    const { container } = render(
      <PortableMessage message={message} scheme="dark" pendingPermission={null} />,
    )
    fireEvent.click(container.querySelector('.tool-node > div')!)

    // Same shell the desktop `DiffView` uses: a 300px window that scrolls, with the
    // line-number gutter outside the horizontally scrolling code column.
    const shell = container.querySelector('.tool-node .grid div.font-mono')!
    expect(shell.className).toContain('max-h-[300px]')
    expect(shell.className).toContain('overflow-y-auto')
    expect(shell.children).toHaveLength(2)
    expect(shell.lastElementChild!.className).toContain('overflow-x-auto')
    expect(shell.firstElementChild!.children).toHaveLength(rows.length)
  })
})
