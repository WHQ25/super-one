/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionCleanupConfirmSession } from '@superone/shared/agent-types'
import { useAppStore } from '@/stores/app'
import { SessionCleanupConfirmPrompt } from './SessionCleanupConfirmPrompt'

const FOLDERS = [
  { id: 'proj-1', path: '/tmp/proj', name: 'proj', addedAt: '2026-01-01', lastOpened: '2026-01-03' },
  { id: 'proj-2', path: '/tmp/other', name: 'other', addedAt: '2026-01-01', lastOpened: '2026-01-02' },
]

function session(
  id: string,
  title: string,
  projectId?: string,
): SessionCleanupConfirmSession {
  return { id, title, harness: 'claude', messageCount: 3, createdAt: '2026-01-01T00:00:00.000Z', projectId }
}

function renderPrompt(sessions: SessionCleanupConfirmSession[]) {
  return render(
    <SessionCleanupConfirmPrompt
      payload={{ sessions }}
      onConfirm={vi.fn()}
      onReject={vi.fn()}
    />,
  )
}

describe('confirming a cross-project session delete', () => {
  beforeEach(() => {
    useAppStore.setState({ recentFolders: FOLDERS, currentProjectId: 'proj-1' })
  })

  it('groups sessions under their project name when ids span projects', () => {
    renderPrompt([
      session('s1', 'Mine', 'proj-1'),
      session('s2', 'Theirs', 'proj-2'),
      session('s3', 'Mine too', 'proj-1'),
    ])

    expect(screen.getByText('proj')).toBeInTheDocument()
    expect(screen.getByText('other')).toBeInTheDocument()
    // Only the calling session's project is marked current.
    expect(screen.getAllByText(/current/)).toHaveLength(1)
  })

  it('names the project even when a single-group delete targets a foreign project', () => {
    // The dangerous case: one unfamiliar repo's sessions, nothing to contrast against.
    renderPrompt([session('s1', 'Theirs', 'proj-2')])

    expect(screen.getByText('other')).toBeInTheDocument()
    expect(screen.queryByText(/current/)).not.toBeInTheDocument()
  })

  it('omits group headers when everything belongs to the current project', () => {
    renderPrompt([session('s1', 'Mine', 'proj-1'), session('s2', 'Mine too', 'proj-1')])

    expect(screen.queryByText('proj')).not.toBeInTheDocument()
    expect(screen.getByText('Mine')).toBeInTheDocument()
  })

  it('falls back to an unknown-project label when the id is not in recentFolders', () => {
    renderPrompt([session('s1', 'Mine', 'proj-1'), session('s2', 'Orphan', 'proj-gone')])

    expect(screen.getByText('Unknown project')).toBeInTheDocument()
  })
})
