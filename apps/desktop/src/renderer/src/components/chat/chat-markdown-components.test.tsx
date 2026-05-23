/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useAppStore } from '@/stores/app'
import { fileLinkComponents } from './chat-markdown-components'

vi.mock('@/components/chat/ChatInput', () => ({
  chatInputAPI: { insertMention: vi.fn() },
}))

const PROJECT = '/Users/me/proj'
const FileLink = fileLinkComponents.a

describe('FileLink chip rendering', () => {
  it('shows the file basename, ignoring a redundant line number in the link text', () => {
    useAppStore.setState({ currentFolder: PROJECT, _worktrees: {} })
    render(
      <FileLink href={`${PROJECT}/apps/desktop/src/MentionPopup.tsx#L243`}>
        MentionPopup.tsx:243
      </FileLink>,
    )
    const chip = screen.getByRole('button')
    expect(chip).toHaveTextContent('MentionPopup.tsx#L243')
    expect(chip.textContent).not.toContain(':243')
  })

  it('shows the real basename even when the link text is a line-range label', () => {
    useAppStore.setState({ currentFolder: PROJECT, _worktrees: {} })
    render(
      <FileLink href={`${PROJECT}/apps/desktop/src/MentionPopup.tsx#L266`}>
        L266-268
      </FileLink>,
    )
    const chip = screen.getByRole('button')
    expect(chip).toHaveTextContent('MentionPopup.tsx#L266')
    expect(chip.textContent).not.toContain('L266-268')
  })

  it('falls back to a plain anchor for links outside the project', () => {
    useAppStore.setState({ currentFolder: PROJECT, _worktrees: {} })
    render(<FileLink href="https://example.com">docs</FileLink>)
    expect(screen.getByRole('link')).toHaveTextContent('docs')
  })
})
