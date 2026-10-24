/** @vitest-environment jsdom */
import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectRef, type DraftListEntry } from '@superone/shared/environment'
import type { EnvironmentBucket, HostCheckout } from '@/lib/multi-host/types'
import { useDraftsStore } from '@/stores/drafts'
import { MultiHostProjectList } from './MultiHostProjectList'

function checkout(partial: Partial<HostCheckout> & Pick<HostCheckout, 'environmentId' | 'projectId' | 'name'>): HostCheckout {
  return {
    ref: projectRef(partial.environmentId, partial.projectId),
    connectionId: partial.connectionId ?? 'local',
    pathKey: partial.pathKey ?? `/p/${partial.projectId}`,
    hostPath: partial.hostPath ?? `/p/${partial.projectId}`,
    repoIdentity: null,
    addedAt: 1,
    lastOpened: 2,
    ...partial,
  }
}

function bucket(partial: Partial<EnvironmentBucket> & Pick<EnvironmentBucket, 'environmentId' | 'connectionId' | 'label'>): EnvironmentBucket {
  return {
    kind: partial.connectionId === 'local' ? 'local' : 'cli-node',
    connection: 'connected',
    projectsStatus: 'ready',
    projectsError: null,
    checkouts: [],
    ...partial,
  }
}

const local = checkout({
  environmentId: 'desktop',
  connectionId: 'local',
  projectId: 'p1',
  name: 'app',
  pathKey: '/src/app',
  hostPath: '/src/app',
})
const remote = checkout({
  environmentId: 'node-1',
  connectionId: 'cli-1',
  projectId: 'p2',
  name: 'remote-app',
  pathKey: 'remote:cli-1:/srv/app',
  hostPath: '/srv/app',
})

function draft(id: string, title: string): DraftListEntry {
  return { id, text: title, title, originSessionId: `sess-${id}`, pendingSync: false } as unknown as DraftListEntry
}

const callbacks = {
  onToggleProject: vi.fn(),
  onToggleEnvironment: vi.fn(),
  onLoadMoreSessions: vi.fn(async () => []),
  onSwitchSession: vi.fn(),
  onPinSession: vi.fn(),
  onHideSession: vi.fn(),
  onRenameSession: vi.fn(),
  onDeleteSession: vi.fn(),
  onEditProject: vi.fn(),
  onRemoveProject: vi.fn(),
  onNewSession: vi.fn(),
  onRefreshEnvironment: vi.fn(),
  onToggleConnection: vi.fn(),
  onAddProject: vi.fn(),
  connectionBusyId: null,
  refreshingConnectionId: null,
}

function renderList(extra?: Partial<ComponentProps<typeof MultiHostProjectList>>) {
  return render(
    <MultiHostProjectList
      environments={[
        bucket({ environmentId: 'desktop', connectionId: 'local', label: 'This Mac', kind: 'local', checkouts: [local] }),
        bucket({ environmentId: 'node-1', connectionId: 'cli-1', label: 'build', checkouts: [remote] }),
      ]}
      groupBy="environment"
      sort="recent"
      expandedProjectKeys={new Set()}
      collapsedEnvironmentIds={[]}
      folderSessions={{}}
      folderSessionsHaveMore={{}}
      loadingFolders={{}}
      openingSession={null}
      draftConnectionIds={[]}
      {...callbacks}
      {...extra}
    />,
  )
}

describe('environment sections', () => {
  beforeEach(() => {
    window.app.listAutomations = vi.fn(async () => [])
    useDraftsStore.setState({ byConnection: {}, resumingDraftId: null, loadDrafts: vi.fn(async () => {}) })
  })

  it('holds only projects, without labels or sticky headers', () => {
    renderList()

    expect(screen.queryByText('Projects')).toBeNull()
    expect(document.querySelector('[data-slot="environment-section-header"]')).toBeNull()
    const row = screen.getByText('This Mac').closest('.group')
    expect(row?.className).toContain('hover:bg-sidebar-hover')
    expect(row?.className).toContain('h-9')
    expect(row?.className).toContain('px-1.5')
    expect(row?.className).not.toContain('sticky')
    const localSection = document.querySelector('[data-environment-id="desktop"]')
    expect(localSection?.querySelector(':scope > .pl-1')?.textContent).toContain('app')
    // List inset matches New Session (mx-2). The hover fill shares that edge; projects indent one step (pl-1).
    const list = localSection?.parentElement
    expect(list?.className.split(/\s+/)).toContain('px-2')
    expect(list?.className.split(/\s+/)).not.toContain('px-1.5')
  })

  it('lists every environment\'s drafts under one heading, ahead of the environments', () => {
    useDraftsStore.setState({ byConnection: { local: [draft('d1', 'Local draft')], 'cli-1': [draft('d2', 'Remote draft')] } })
    renderList({ draftConnectionIds: ['local', 'cli-1'] })

    const firstSection = document.querySelector('[data-environment-id]')!
    const heading = screen.getByText('Drafts')
    expect(heading.compareDocumentPosition(screen.getByText('Local draft')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const title of ['Local draft', 'Remote draft']) {
      const row = screen.getByText(title)
      expect(row.closest('[data-environment-id]')).toBeNull()
      expect(row.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('folds a collapsed environment\'s projects away', () => {
    renderList({ collapsedEnvironmentIds: ['desktop'] })

    expect(screen.queryByText('app')).toBeNull()
    expect(screen.getByText('remote-app')).toBeInTheDocument()
  })

  it('dims an offline environment\'s drafts and hides its projects', () => {
    useDraftsStore.setState({ byConnection: { 'cli-1': [draft('d2', 'Remote draft')] } })
    renderList({
      environments: [
        bucket({
          environmentId: 'node-1',
          connectionId: 'cli-1',
          label: 'build',
          connection: 'offline',
          projectsStatus: 'idle',
          checkouts: [remote],
        }),
      ],
      draftConnectionIds: ['cli-1'],
    })

    expect(screen.queryByText('remote-app')).toBeNull()
    expect(screen.getByText('Remote draft').closest('.group\\/draft')).toHaveClass('opacity-50')
  })
})
