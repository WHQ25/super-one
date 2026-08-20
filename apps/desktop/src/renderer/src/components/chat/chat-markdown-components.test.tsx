/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useAppStore } from '@/stores/app'
import { chatInputAPI } from '@/components/chat/chat-input-api'
import { openBrowserTab } from '@/components/activity/activity-panel-api'
import { fileLinkComponents } from './chat-markdown-components'

vi.mock('@/components/chat/chat-input-api', () => ({
  chatInputAPI: { insertMention: vi.fn() },
}))

vi.mock('@/components/activity/activity-panel-api', () => ({
  openBrowserTab: vi.fn(),
  openFileTab: vi.fn(),
}))

const PROJECT = '/Users/me/proj'
const FileLink = fileLinkComponents.a

beforeEach(() => {
  vi.mocked(chatInputAPI.insertMention!).mockClear()
  vi.mocked(openBrowserTab).mockClear()
  // DOM context menu (not native liquid-glass) so Add to Chat is clickable in jsdom.
  useAppStore.setState({ liquidGlass: false })
})

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

  it('renders a bare relative path as a file chip, not an http link', () => {
    useAppStore.setState({ currentFolder: PROJECT, _worktrees: {} })
    render(
      <FileLink href="apps/desktop/src/main/mcp/superone-mcp-server.ts">
        superone-mcp-server.ts
      </FileLink>,
    )
    const chip = screen.getByRole('button')
    expect(chip).toHaveTextContent('superone-mcp-server.ts')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('never maps http(s) localhost hrefs to file chips — always plain anchors', () => {
    useAppStore.setState({ currentFolder: PROJECT, _worktrees: {} })
    // Historical harden defaultOrigin artifact — must not become a file chip.
    render(
      <FileLink href="https://localhost/apps/desktop/src/main/mcp/superone-mcp-server.ts">
        superone-mcp-server.ts
      </FileLink>,
    )
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://localhost/apps/desktop/src/main/mcp/superone-mcp-server.ts',
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders Storybook loopback URLs as plain anchors, not file chips', () => {
    useAppStore.setState({ currentFolder: PROJECT, _worktrees: {} })
    const href = 'http://localhost:6006/?path=/story/agentcollaboration-toolui--gallery'
    render(<FileLink href={href}>{href}</FileLink>)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', href)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders absolute project filesystem paths as file chips', () => {
    useAppStore.setState({ currentFolder: PROJECT, _worktrees: {} })
    render(
      <FileLink href={`${PROJECT}/apps/desktop/src/main/mcp/superone-mcp-server.ts`}>
        superone-mcp-server.ts
      </FileLink>,
    )
    const chip = screen.getByRole('button')
    expect(chip).toHaveTextContent('superone-mcp-server.ts')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('decodes percent-encoded CJK hrefs for chip path and prefers link text as label', () => {
    useAppStore.setState({ currentFolder: PROJECT, _worktrees: {} })
    const encoded = `${PROJECT}/docs/S-C-%E8%AF%8A%E6%96%ADSQL.md`
    const decoded = `${PROJECT}/docs/S-C-诊断SQL.md`
    render(<FileLink href={encoded}>S-C-诊断SQL.md</FileLink>)
    const chip = screen.getByRole('button')
    expect(chip).toHaveTextContent('S-C-诊断SQL.md')
    expect(chip).toHaveAttribute('title', decoded)
    expect(chip.textContent).not.toContain('%E8')
  })

  it('falls back to decoded basename when link text equals the raw encoded href', () => {
    useAppStore.setState({ currentFolder: PROJECT, _worktrees: {} })
    const encoded = `${PROJECT}/docs/%E8%AF%8A%E6%96%AD.md`
    render(<FileLink href={encoded}>{encoded}</FileLink>)
    const chip = screen.getByRole('button')
    expect(chip).toHaveTextContent('诊断.md')
    expect(chip).toHaveAttribute('title', `${PROJECT}/docs/诊断.md`)
  })

  it('Add to Chat inserts a decoded project-relative path (not percent-encoded)', () => {
    useAppStore.setState({ currentFolder: PROJECT, _worktrees: {} })
    const encoded = `${PROJECT}/docs/S-C-%E8%AF%8A%E6%96%ADSQL.md`
    render(<FileLink href={encoded}>S-C-诊断SQL.md</FileLink>)
    const chip = screen.getByRole('button')
    fireEvent.contextMenu(chip)
    fireEvent.click(screen.getByText('Add to Chat'))
    expect(chatInputAPI.insertMention).toHaveBeenCalledWith(
      'file',
      'docs/S-C-诊断SQL.md',
      'S-C-诊断SQL.md',
    )
    const mentionPath = vi.mocked(chatInputAPI.insertMention!).mock.calls[0]![1]
    expect(mentionPath).not.toContain('%E8')
  })

  it('shows Preview in Browser for HTML chips and opens a local-file URL', () => {
    useAppStore.setState({ currentFolder: PROJECT, _worktrees: {} })
    render(<FileLink href={`${PROJECT}/docs/index.html`}>index.html</FileLink>)
    fireEvent.contextMenu(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Preview in Browser'))
    expect(openBrowserTab).toHaveBeenCalledWith(`local-file://${PROJECT}/docs/index.html`)
  })

  it('shows Preview in Browser when the chip label is not the html filename', () => {
    useAppStore.setState({ currentFolder: PROJECT, _worktrees: {} })
    render(<FileLink href={`${PROJECT}/docs/page.htm`}>homepage</FileLink>)
    fireEvent.contextMenu(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Preview in Browser'))
    expect(openBrowserTab).toHaveBeenCalledWith(`local-file://${PROJECT}/docs/page.htm`)
  })

  it('does not show Preview in Browser for non-HTML files', () => {
    useAppStore.setState({ currentFolder: PROJECT, _worktrees: {} })
    render(<FileLink href={`${PROJECT}/src/app.ts`}>app.ts</FileLink>)
    fireEvent.contextMenu(screen.getByRole('button'))
    expect(screen.getByText('Add to Chat')).toBeInTheDocument()
    expect(screen.queryByText('Preview in Browser')).toBeNull()
  })
})
