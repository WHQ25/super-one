/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReplyCommentChips } from './ReplyCommentChips'
import type { ReplyComment } from '@/stores/chat'

const PROSE: ReplyComment = {
  id: 'c1',
  messageId: 'm1',
  anchorText: 'a passage',
  quote: 'a passage',
  text: '是多少',
}

const DIFF: ReplyComment = {
  id: 'c2',
  messageId: null,
  anchorText: 'src/app.ts:L2:D\n-const b = 2\n+const b = 999',
  quote: 'src/app.ts:L2:D\n-const b = 2\n+const b = 999',
  text: 'keep the old default',
  surface: 'code',
}

describe('ReplyCommentChips', () => {
  it('renders one comment as the same count list as several, with a diff block', () => {
    const onOpen = vi.fn()
    render(<ReplyCommentChips comments={[PROSE]} onOpen={onOpen} onRemove={vi.fn()} onClear={vi.fn()} />)

    expect(screen.getByRole('button', { name: /1 comment/ })).toBeInTheDocument()
    expect(screen.queryByText('是多少')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /1 comment/ }))
    expect(screen.getByText('是多少')).toBeInTheDocument()
    expect(screen.getByText('a passage')).toBeInTheDocument()

    fireEvent.click(screen.getByText('是多少'))
    expect(onOpen).toHaveBeenCalledWith('c1')
  })

  it('quotes a diff as added and removed lines, starting at the card edge', () => {
    render(<ReplyCommentChips comments={[PROSE, DIFF]} onOpen={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /2 comments/ }))

    const added = document.body.querySelector('[data-comment-diff="added"]')
    const removed = document.body.querySelector('[data-comment-diff="removed"]')
    expect(added?.textContent).toBe('+const b = 999')
    expect(removed?.textContent).toBe('-const b = 2')
    const title = screen.getByText('keep the old default')
    const row = title.parentElement!.parentElement!
    // The quote sits under the comment row. The close control stays on that row.
    expect(row.contains(added!)).toBe(false)
    expect(row.nextElementSibling?.contains(added!)).toBe(true)
    const remove = row.querySelector('button[aria-label="Delete"]')
    expect(remove).not.toBeNull()
    expect(row.nextElementSibling?.contains(remove!)).toBe(false)
  })

  it('highlights inline code in a prose quote instead of leaving the backticks', () => {
    render(
      <ReplyCommentChips
        comments={[{ ...PROSE, quote: '按 `acp-grok` 挂载' }]}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onClear={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /1 comment/ }))
    const code = screen.getByText('acp-grok')
    expect(code.tagName).toBe('CODE')
    expect(screen.queryByText(/`acp-grok`/)).toBeNull()
  })
})
