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

beforeEach(() => {
  vi.mocked(openBrowserTab).mockClear()
  useAppStore.setState({ liquidGlass: false, currentFolder: PROJECT, _worktrees: {} })
})

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
