/** @vitest-environment jsdom */

import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { sanitizeRemoteToolInput } from '@superone/shared/remote-tool-input'

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
  it('counts a privacy-projected multi-file patch in Detail before its bodies are fetched', () => {
    const patchText = '*** Begin Patch\n*** Update File: /workspace/a.ts\n@@\n-private-old\n+private-new\n+extra\n*** Update File: /workspace/a.ts\n@@\n-old2\n+new2\n*** Add File: /workspace/b.ts\n+one\n+two\n*** End Patch'
    const message: ChatMessage = {
      ...turnWithLoneEdit(), providerId: 'opencode',
      content: [
        { type: 'tool_use', toolName: 'Read', toolUseId: 'read', input: '{"file_path":"/workspace/a.ts"}', status: 'complete' },
        { type: 'tool_result', toolUseId: 'read', summary: '' },
        { type: 'tool_use', toolName: 'Patch', toolUseId: 'patch', input: sanitizeRemoteToolInput('Patch', JSON.stringify({ patchText })), status: 'complete' },
        { type: 'tool_result', toolUseId: 'patch', summary: '' },
        { type: 'tool_use', toolName: 'CodeExecution', toolUseId: 'code', input: '{"language":"JavaScript"}', status: 'complete' },
        { type: 'tool_result', toolUseId: 'code', summary: '' },
        { type: 'text', text: 'Updated the files.' },
      ],
    }
    const { container } = render(<PortableMessage message={message} scheme="dark" pendingPermission={null} />)
    const detail = container.querySelector('.turn-detail-section > button') as HTMLButtonElement
    expect(within(detail).getByTitle('2 files changed')).toHaveTextContent('2')
    expect(within(detail).getByText('+5')).toBeInTheDocument()
    expect(within(detail).getByText('-2')).toBeInTheDocument()
    expect(container.textContent).not.toContain('private-new')
    fireEvent.click(detail)
    const patch = container.querySelector('[data-tool-use-id="patch"]') as HTMLElement
    expect(within(patch).getByText('2 files')).toBeInTheDocument()
    expect(within(patch).getByText('+5')).toBeInTheDocument()
    expect(within(patch).getByText('-2')).toBeInTheDocument()
  })

  it('draws the diff of a tool call that is alone in its turn', () => {
    const { container } = render(
      <PortableMessage message={turnWithLoneEdit()} scheme="dark" pendingPermission={null} />,
    )

    // The header counter is the cheapest proof `toolLineDelta` survived the turn body.
    expect(within(container).getByText('+1')).toBeInTheDocument()
    expect(within(container).getByText('-1')).toBeInTheDocument()

    fireEvent.click(container.querySelector('.tool-node > div')!)
    // Highlighted lines split into one span per token.
    const lines = [...container.querySelectorAll('.tool-node .whitespace-pre')].map(line => line.textContent)
    expect(lines).toContain('+const previewEnabled = true')
    expect(lines).toContain('-const previewEnabled = false')
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

    // A 300px window that owns both scroll axes, with a line-number gutter that
    // sticks to the left edge while the code scrolls horizontally.
    const shell = container.querySelector('.tool-node .grid div.font-mono')!
    expect(shell.className).toContain('max-h-[300px]')
    expect(shell.className).toContain('overflow-auto')
    expect(shell.children).toHaveLength(1)
    expect(shell.firstElementChild!.children).toHaveLength(rows.length)
    expect(shell.firstElementChild!.firstElementChild!.firstElementChild!.className).toContain('sticky left-0')
  })
})
