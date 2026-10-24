/** @vitest-environment jsdom */
import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectRef } from '@superone/shared/environment'
import type { EnvironmentBucket, HostCheckout } from '@/lib/multi-host/types'
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
      {...callbacks}
      {...extra}
    />,
  )
}

describe('environment sections', () => {
  beforeEach(() => {
    window.app.listAutomations = vi.fn(async () => [])
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

  it('folds a collapsed environment\'s projects away', () => {
    renderList({ collapsedEnvironmentIds: ['desktop'] })

    expect(screen.queryByText('app')).toBeNull()
    expect(screen.getByText('remote-app')).toBeInTheDocument()
  })

  it('hides an offline environment\'s projects', () => {
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
    })

    expect(screen.queryByText('remote-app')).toBeNull()
  })
})
