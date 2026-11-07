/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { wrapPathRefMention } from '@superone/shared/miniapp-prompt-tags'
import { useAppStore } from '@/stores/app'
import { SessionScopeProvider } from '@/stores/chat-store/session-scope'
import { openFileTab, openNewFileTab } from '@/components/activity/activity-panel-api'
import type { NodeViewProps } from '@tiptap/react'
import { UserTextPresenter } from '@superone/chat-view/presenters/UserText'
import { DesktopUserBubblePorts } from './user-bubble-ports'
import { MentionChip } from './MentionChip'

vi.mock('@/components/activity/activity-panel-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  openBrowserTab: vi.fn(),
  openFileTab: vi.fn(),
  openNewFileTab: vi.fn(),
}))

const PROJECT = '/Users/me/proj'
const writeText = vi.fn<(text: string) => Promise<void>>()

beforeEach(() => {
  vi.mocked(openFileTab).mockClear()
  vi.mocked(openNewFileTab).mockClear()
  writeText.mockClear().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  useAppStore.setState({ liquidGlass: false, currentFolder: PROJECT, _worktrees: {} })
})

describe('sent file mention chip', () => {
  it('opens the file tab on click', () => {
    render(<DesktopUserBubblePorts><UserTextPresenter text={`see ${wrapPathRefMention('file', 'src/app.ts', 'app.ts')}`} /></DesktopUserBubblePorts>)
    fireEvent.click(screen.getByRole('button'))
    expect(openNewFileTab).toHaveBeenCalledWith(`${PROJECT}/src/app.ts`, { fileRoot: PROJECT })
  })

  it('offers the file chip context menu', () => {
    render(<DesktopUserBubblePorts><UserTextPresenter text={`see ${wrapPathRefMention('file', 'src/app.ts', 'app.ts')}`} /></DesktopUserBubblePorts>)
    fireEvent.contextMenu(screen.getByRole('button'))
    expect(screen.getByText('Add to Chat')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Copy Path'))
    expect(writeText).toHaveBeenCalledWith(`${PROJECT}/src/app.ts`)
  })

  it('drags from the icon only and keeps the name selectable, like FileChip', () => {
    render(<DesktopUserBubblePorts><UserTextPresenter text={`see ${wrapPathRefMention('file', 'src/app.ts', 'app.ts')}`} /></DesktopUserBubblePorts>)
    const chip = screen.getByRole('button')
    expect(chip).not.toHaveAttribute('draggable')
    expect(chip).not.toHaveClass('select-none')
    expect(chip.querySelector('.mention-chip__icon')).toHaveAttribute('draggable', 'true')
  })

  it('leaves non-file mentions inert', () => {
    render(<DesktopUserBubblePorts><UserTextPresenter text={`see ${wrapPathRefMention('directory', 'src/', 'src')}`} /></DesktopUserBubblePorts>)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('composer file mention chip', () => {
  const renderComposerChip = (kind: string, value: string, displayName: string) =>
    render(<DesktopUserBubblePorts><MentionChip {...({ node: { attrs: { kind, value, displayName } } } as unknown as NodeViewProps)} /></DesktopUserBubblePorts>)

  it('opens the file tab on click and offers the file chip context menu', () => {
    renderComposerChip('file', 'src/app.ts', 'app.ts')
    fireEvent.click(screen.getByRole('button'))
    expect(openNewFileTab).toHaveBeenCalledWith(`${PROJECT}/src/app.ts`, { fileRoot: PROJECT })
    fireEvent.contextMenu(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Copy Relative Path'))
    expect(writeText).toHaveBeenCalledWith('src/app.ts')
  })

  it('drags from the icon only and stays an atom in the editor', () => {
    renderComposerChip('file', 'src/app.ts', 'app.ts')
    const chip = screen.getByRole('button')
    expect(chip).toHaveAttribute('data-mention')
    expect(chip).toHaveAttribute('contenteditable', 'false')
    expect(chip).not.toHaveAttribute('draggable')
    expect(chip.querySelector('.mention-chip__icon')).toHaveAttribute('draggable', 'true')
  })

  it('leaves non-file mentions inert', () => {
    renderComposerChip('directory', 'src', 'src')
    expect(screen.queryByRole('button')).toBeNull()
  })
})


describe('remote file mention ownership', () => {
  it('opens and copies the remote path while a local project is focused', () => {
    const root = 'remote:node-b:/srv/repo'
    render(<SessionScopeProvider value={{ projectPath: root, sessionId: 'remote-chat' }}>
      <DesktopUserBubblePorts><UserTextPresenter text={wrapPathRefMention('file', 'src/app.ts', 'app.ts')} /></DesktopUserBubblePorts>
    </SessionScopeProvider>)
    fireEvent.click(screen.getByRole('button'))
    expect(openNewFileTab).toHaveBeenCalledWith('/srv/repo/src/app.ts', { fileRoot: root })
    expect(openFileTab).not.toHaveBeenCalled()
    fireEvent.contextMenu(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Copy Path'))
    expect(writeText).toHaveBeenCalledWith('/srv/repo/src/app.ts')
  })
})
