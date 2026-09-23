/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useAppStore } from '@/stores/app'
import { openBrowserTab } from '@/components/activity/activity-panel-api'
import { FileChip } from './FileChip'

vi.mock('@/components/activity/activity-panel-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  openBrowserTab: vi.fn(),
  openFileTab: vi.fn(),
}))

const PROJECT = '/Users/me/proj'

const writeText = vi.fn<(text: string) => Promise<void>>()

beforeEach(() => {
  vi.mocked(openBrowserTab).mockClear()
  writeText.mockClear().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  useAppStore.setState({ liquidGlass: false, currentFolder: PROJECT, _worktrees: {} })
})

function openMenu(entry: string): void {
  fireEvent.contextMenu(screen.getByRole('button'))
  fireEvent.click(screen.getByText(entry))
}

describe('FileChip context menu', () => {
  it('shows Preview in Browser for HTML files and opens a local-file URL', () => {
    render(<FileChip name="index.html" title="index.html" filePath="index.html" />)
    fireEvent.contextMenu(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Preview in Browser'))
    expect(openBrowserTab).toHaveBeenCalledWith(`local-file://${PROJECT}/index.html`)
  })

  it('resolves an absolute HTML path without joining the project root twice', () => {
    render(<FileChip name="page.htm" title="page.htm" filePath={`${PROJECT}/docs/page.htm`} />)
    fireEvent.contextMenu(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Preview in Browser'))
    expect(openBrowserTab).toHaveBeenCalledWith(`local-file://${PROJECT}/docs/page.htm`)
  })

  it('does not show Preview in Browser for non-HTML files', () => {
    render(<FileChip name="app.ts" title="app.ts" filePath="src/app.ts" />)
    fireEvent.contextMenu(screen.getByRole('button'))
    expect(screen.getByText('Add to Chat')).toBeInTheDocument()
    expect(screen.queryByText('Preview in Browser')).toBeNull()
  })

  it('has no context menu when filePath is missing', () => {
    render(<FileChip name="index.html" title="index.html" />)
    fireEvent.contextMenu(screen.getByRole('button'))
    expect(screen.queryByText('Preview in Browser')).toBeNull()
    expect(screen.queryByText('Add to Chat')).toBeNull()
  })
})

describe('FileChip copy path', () => {
  it('copies the absolute path for a project-relative chip', () => {
    render(<FileChip name="app.ts" title="app.ts" filePath="src/app.ts" />)
    openMenu('Copy Path')
    expect(writeText).toHaveBeenCalledWith(`${PROJECT}/src/app.ts`)
  })

  it('copies the relative path for an absolute chip under the project root', () => {
    render(<FileChip name="app.ts" title="app.ts" filePath={`${PROJECT}/src/app.ts`} />)
    openMenu('Copy Relative Path')
    expect(writeText).toHaveBeenCalledWith('src/app.ts')
  })

  it('keeps an absolute path outside the project root intact for both entries', () => {
    render(<FileChip name="notes.md" title="notes.md" filePath="/tmp/notes.md" />)
    openMenu('Copy Path')
    expect(writeText).toHaveBeenCalledWith('/tmp/notes.md')
    openMenu('Copy Relative Path')
    expect(writeText).toHaveBeenLastCalledWith('/tmp/notes.md')
  })

  it('unwraps a remote project key when building the absolute path', () => {
    useAppStore.setState({ currentFolder: `remote:conn-1:${PROJECT}` })
    render(<FileChip name="app.ts" title="app.ts" filePath="src/app.ts" />)
    openMenu('Copy Path')
    expect(writeText).toHaveBeenCalledWith(`${PROJECT}/src/app.ts`)
  })
})
