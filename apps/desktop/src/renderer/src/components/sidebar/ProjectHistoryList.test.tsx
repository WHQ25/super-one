/** @vitest-environment jsdom */

import { render, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ProjectHistoryList } from './ProjectHistoryList'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'

// jsdom has no layout, so the real virtualizer would render zero rows.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 34,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      key: index, index, start: index * 34, size: 34,
    })),
    measureElement: () => {},
  }),
}))

function dbEntry(sessionId: string, title: string): SessionHistoryEntry {
  return { sessionId, title, lastActiveAt: '0', messageCount: 0 }
}

const listSessionsForFolderPage = vi.fn<(folderPath: string, limit: number, offset: number) => Promise<SessionHistoryEntry[]>>()
const listSessionsForFolder = vi.fn<(folderPath: string) => Promise<SessionHistoryEntry[]>>()
const onSessionChanged = vi.fn(() => () => {})

const noopCallbacks = {
  onPinSession: vi.fn(),
  onHideSession: vi.fn(),
  onRenameSession: vi.fn(),
  onDeleteSession: vi.fn(),
}

function titleRows(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.session-row-title')).map((el) => el.textContent ?? '')
}

describe('ProjectHistoryList — in-sidebar scrollable session history', () => {
  beforeEach(() => {
    listSessionsForFolderPage.mockReset()
    listSessionsForFolder.mockReset()
    onSessionChanged.mockClear()
    ;(window as unknown as { app: unknown }).app = new Proxy(
      { listSessionsForFolderPage, listSessionsForFolder, onSessionChanged },
      {
        get: (target, prop) => prop in target
          ? (target as Record<string | symbol, unknown>)[prop]
          : () => Promise.resolve(undefined),
      },
    )
  })

  it("renders a search box and the project's first page of sessions", async () => {
    listSessionsForFolderPage.mockResolvedValue([dbEntry('s1', 'First chat'), dbEntry('s2', 'Second chat')])

    const { container, getByPlaceholderText } = render(
      <ProjectHistoryList folderPath="/proj" onClose={vi.fn()} onSwitchSession={vi.fn()} {...noopCallbacks} />,
    )

    await waitFor(() => expect(titleRows(container)).toContain('First chat'))
    expect(listSessionsForFolderPage).toHaveBeenCalledWith('/proj', 30, 0)
    expect(getByPlaceholderText(/search/i)).toBeTruthy()
  })

  it('shows seeded initialSessions on the first render, before the fetch resolves', () => {
    listSessionsForFolderPage.mockReturnValue(new Promise(() => {}))

    const { container } = render(
      <ProjectHistoryList
        folderPath="/proj"
        initialSessions={[dbEntry('seed', 'Seeded chat')]}
        onClose={vi.fn()}
        onSwitchSession={vi.fn()}
        {...noopCallbacks}
      />,
    )

    expect(titleRows(container)).toContain('Seeded chat')
  })

  it('loads the next page when the list is scrolled to the bottom', async () => {
    const firstPage = Array.from({ length: 30 }, (_, i) => dbEntry(`a${i}`, `Session ${i}`))
    listSessionsForFolderPage.mockImplementation(async (_folder, _limit, offset) =>
      offset === 0 ? firstPage : [dbEntry('older', 'Older session')],
    )

    const { container } = render(
      <ProjectHistoryList folderPath="/proj" onClose={vi.fn()} onSwitchSession={vi.fn()} {...noopCallbacks} />,
    )
    await waitFor(() => expect(titleRows(container)).toContain('Session 0'))

    fireEvent.scroll(container.querySelector('.overscroll-contain')!)

    await waitFor(() => expect(titleRows(container)).toContain('Older session'))
    expect(listSessionsForFolderPage).toHaveBeenCalledWith('/proj', 30, 30)
  })

  it('searches every session in the project, not just the loaded page', async () => {
    listSessionsForFolderPage.mockResolvedValue([dbEntry('recent', 'Recent chat')])
    listSessionsForFolder.mockResolvedValue([
      dbEntry('recent', 'Recent chat'),
      dbEntry('ancient', 'Ancient bugfix notes'),
    ])

    const { container, getByPlaceholderText } = render(
      <ProjectHistoryList folderPath="/proj" onClose={vi.fn()} onSwitchSession={vi.fn()} {...noopCallbacks} />,
    )
    await waitFor(() => expect(titleRows(container)).toContain('Recent chat'))

    fireEvent.change(getByPlaceholderText(/search/i), { target: { value: 'ancient' } })

    await waitFor(() => expect(titleRows(container)).toContain('Ancient bugfix notes'))
    expect(listSessionsForFolder).toHaveBeenCalledWith('/proj')
    expect(titleRows(container)).not.toContain('Recent chat')
  })

  it('switches to the clicked session but stays in history mode', async () => {
    listSessionsForFolderPage.mockResolvedValue([dbEntry('s1', 'Pick me')])
    const onSwitchSession = vi.fn()
    const onClose = vi.fn()

    const { container } = render(
      <ProjectHistoryList folderPath="/proj" onClose={onClose} onSwitchSession={onSwitchSession} {...noopCallbacks} />,
    )
    let row: HTMLElement | null = null
    await waitFor(() => {
      row = container.querySelector<HTMLElement>('.session-row-title')
      expect(row).not.toBeNull()
    })

    fireEvent.click(row!)

    expect(onSwitchSession).toHaveBeenCalledWith('/proj', 's1')
    expect(onClose).not.toHaveBeenCalled()
  })
})
