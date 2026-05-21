/** @vitest-environment jsdom */

import { render, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SessionHistory } from './SessionHistory'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore, type ProjectState } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'

// The virtualizer never measures its scroll element in jsdom; render every row instead.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      key: index, index, start: index * 36, size: 36,
    })),
  }),
}))

function dbEntry(sessionId: string, title: string): SessionHistoryEntry {
  return { sessionId, title, lastActiveAt: '0', messageCount: 0 }
}

function makeProject(activeSid: string): ProjectState {
  return {
    ...createDefaultProjectState(),
    _activeSessionId: activeSid,
    _sessions: { [activeSid]: createDefaultPerSessionState() },
  }
}

const listSessionsForFolderPage = vi.fn<(folderPath: string, limit: number, offset: number) => Promise<SessionHistoryEntry[]>>()

function findTitleRow(container: HTMLElement, title: string): HTMLElement | null {
  return Array.from(container.querySelectorAll<HTMLElement>('.animated-title-wrap'))
    .find((el) => el.textContent === title) ?? null
}

describe('SessionHistory — folder-scoped, decoupled from the active project', () => {
  beforeEach(() => {
    listSessionsForFolderPage.mockReset()
    ;(window as unknown as { app: unknown }).app = new Proxy({ listSessionsForFolderPage }, {
      get: (target, prop) => prop in target
        ? (target as Record<string | symbol, unknown>)[prop]
        : () => Promise.resolve(undefined),
    })
    useChatStore.setState({
      activeProject: '/project-a',
      projectSessions: { '/project-a': makeProject('a-active'), '/project-b': makeProject('b-active') },
    })
  })

  afterEach(() => {
    useChatStore.setState({ activeProject: null, projectSessions: {} })
  })

  it('shows another project history without switching the working project', async () => {
    listSessionsForFolderPage.mockResolvedValue([dbEntry('b-old', 'Project B old chat')])

    const { container } = render(<SessionHistory folderPath="/project-b" onClose={vi.fn()} />)

    await waitFor(() => expect(findTitleRow(container, 'Project B old chat')).not.toBeNull())
    expect(listSessionsForFolderPage).toHaveBeenCalledWith('/project-b', 30, 0)
    // The bug: opening history for /project-b used to hijack the active project.
    expect(useChatStore.getState().activeProject).toBe('/project-a')
  })

  it('switches project + session only when a history row is explicitly clicked', async () => {
    listSessionsForFolderPage.mockResolvedValue([dbEntry('b-old', 'Project B old chat')])
    const selectProject = vi.fn().mockResolvedValue(undefined)
    const switchSession = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ selectProject })
    useChatStore.setState({ switchSession })

    const { container } = render(<SessionHistory folderPath="/project-b" onClose={vi.fn()} />)

    let row: HTMLElement | null = null
    await waitFor(() => {
      row = findTitleRow(container, 'Project B old chat')
      expect(row).not.toBeNull()
    })
    fireEvent.click(row!)

    await waitFor(() => expect(selectProject).toHaveBeenCalledWith('/project-b'))
    expect(switchSession).toHaveBeenCalledWith('b-old')
  })
})
