/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import type { PinnedSessionEntry, RecentFolder } from '@superone/shared/agent-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { MentionPopup } from './MentionPopup'
import { SESSION_META_CLASS, STACKED_DETAIL_CLASS } from './mention-row-layout'

const folder = (path: string, name: string): RecentFolder => ({
  id: path, path, name, lastOpened: '2026-01-01T00:00:00.000Z', addedAt: '2026-01-01T00:00:00.000Z',
})

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()

const sessions: PinnedSessionEntry[] = [
  { sessionId: 'a', title: 'Align the mention popup', lastActiveAt: hoursAgo(1), messageCount: 1, provider: 'claude', folderPath: '/repo', folderName: 'super-one' },
  { sessionId: 'b', title: 'Probe OpenCode mentions', lastActiveAt: hoursAgo(24 * 3), messageCount: 1, provider: 'opencode', folderPath: '/other', folderName: 'relay' },
]

function renderPopup(query: string) {
  return render(
    <MentionPopup
      query={query}
      selectedIndex={0}
      onSelect={() => {}}
      onSetSelectedIndex={() => {}}
      onClose={() => {}}
    />,
  )
}

describe('session mention rows', () => {
  beforeEach(() => {
    useChatStore.setState({ activeProject: '/repo' })
    useAppStore.setState({
      currentFolder: '/repo',
      recentFolders: [folder('/repo', 'super-one'), folder('/other', 'relay')],
    })
    window.environment.searchSessionsByTitle = vi.fn(async () => sessions)
  })

  it('puts the project and age next to each other in one text style', async () => {
    renderPopup('session ')
    const recent = await screen.findByText('1h')
    const older = screen.getByText('3d')
    const project = screen.getByText('super-one')
    expect(screen.queryByText('Claude')).not.toBeInTheDocument()
    expect(screen.queryByText('OpenCode')).not.toBeInTheDocument()
    expect(recent.className).toContain('shrink-0')
    expect(recent.className).not.toContain('text-right')
    expect(project.className).toBe(STACKED_DETAIL_CLASS)
    expect(screen.getByText('relay').className).toBe(STACKED_DETAIL_CLASS)
    expect(recent.parentElement?.className).toBe(SESSION_META_CLASS)
    expect(older.parentElement?.className).toBe(SESSION_META_CLASS)
    expect(recent.parentElement).toBe(project.parentElement)
    expect(SESSION_META_CLASS).not.toContain('grid')
  })

  it('keeps the age in that same style when the project is hidden', async () => {
    renderPopup('session super-one ')
    const recent = await screen.findByText('1h')
    expect(recent.closest('button')?.textContent).not.toContain('super-one')
    expect(recent.className).toContain('shrink-0')
    expect(recent.parentElement?.className).toContain(SESSION_META_CLASS)
  })
})
