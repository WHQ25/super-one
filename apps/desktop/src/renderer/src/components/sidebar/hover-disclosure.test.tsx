/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectRef } from '@superone/shared/environment'
import type { EnvironmentBucket, HostCheckout } from '@/lib/multi-host/types'
import { EnvironmentSectionHeader } from './multi-host/EnvironmentSectionHeader'
import { MultiHostProjectList } from './multi-host/MultiHostProjectList'
import { ProjectSidebarRow } from './ProjectSidebarRow'
import type { RecentFolder } from '@superone/shared/agent-types'

const folder: RecentFolder = {
  id: 'app',
  name: 'super-one',
  path: '/src/app',
  addedAt: '2026-10-09T00:00:00.000Z',
  lastOpened: '2026-10-09T00:00:00.000Z',
}

const callbacks = {
  onSwitchSession: vi.fn(),
  onPinSession: vi.fn(),
  onHideSession: vi.fn(),
  onRenameSession: vi.fn(),
  onDeleteSession: vi.fn(),
  onToggleExpand: vi.fn(),
  onEditProject: vi.fn(),
  onRemoveProject: vi.fn(),
  onNewSession: vi.fn(),
  onLoadMoreSessions: vi.fn(async () => []),
}

function checkout(partial: Partial<HostCheckout> & Pick<HostCheckout, 'environmentId' | 'projectId' | 'name'>): HostCheckout {
  return {
    ref: projectRef(partial.environmentId, partial.projectId),
    connectionId: partial.connectionId ?? 'local',
    pathKey: partial.pathKey ?? `/p/${partial.projectId}`,
    hostPath: partial.hostPath ?? `/p/${partial.projectId}`,
    repoIdentity: 'git:https://github.com/acme/app.git',
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

function expectSharedSlot(row: Element | null, glyph: string, size: string) {
  expect(row).not.toBeNull()
  const chevron = row?.querySelector('.lucide-chevron-right')
  const icon = row?.querySelector(glyph)
  const chevronClass = chevron?.getAttribute('class') ?? ''
  expect(chevronClass).toContain('hidden')
  expect(chevronClass).toContain('group-hover:block')
  expect(chevronClass).toContain('size-full')
  expect(icon?.getAttribute('class')).toContain('group-hover:hidden')
  expect(icon?.getAttribute('class')).toContain('size-full')
  expect(icon?.parentElement).toBe(chevron?.parentElement)
  expect(icon?.parentElement?.className).toContain('grid')
  expect(icon?.parentElement?.className).toContain(size)
}

describe('sidebar hover disclosure', () => {
  beforeEach(() => {
    window.app.listAutomations = vi.fn(async () => [])
  })

  it('keeps project actions hidden until the row is hovered', () => {
    render(
      <ProjectSidebarRow
        {...callbacks}
        folder={folder}
        sessions={[]}
        hasMoreSessions={false}
        isExpanded={false}
      />,
    )
    const row = screen.getByText('super-one').closest('.h-9')
    expectSharedSlot(row, '.lucide-folder', 'size-4')
    const actions = row?.querySelector('[data-slot="project-row-actions"]')
    const actionClass = actions?.getAttribute('class') ?? ''
    expect(actionClass).toContain('opacity-0')
    expect(actionClass).toContain('invisible')
    expect(actionClass).toContain('w-0')
    expect(actionClass).toContain('group-hover:w-auto')
    expect(actionClass).toContain('group-hover:opacity-100')
    expect(actions?.querySelector('[aria-label="Search sessions…"]')).not.toBeNull()
    expect(actions?.querySelector('[aria-label="New Automation"]')).not.toBeNull()
    expect(actions?.querySelector('[aria-label="New Session"]')).not.toBeNull()
  })

  it('uses the same slot for a host section', () => {
    render(
      <EnvironmentSectionHeader
        label="This Mac"
        kind="local"
        connection="connected"
        expanded
        projectsStatus="ready"
        projectsError={null}
        onToggle={() => {}}
      />,
    )
    expectSharedSlot(document.querySelector('.group'), '.lucide-monitor', 'size-4')
  })

  it('uses the same project hover chrome for a merged repository', () => {
    const local = checkout({ environmentId: 'desktop', connectionId: 'local', projectId: 'p1', name: 'app', pathKey: '/src/app', hostPath: '/src/app' })
    const remote = checkout({ environmentId: 'node-1', connectionId: 'cli-1', projectId: 'p2', name: 'app', pathKey: 'remote:cli-1:/srv/app', hostPath: '/srv/app', lastOpened: 1 })
    render(
      <MultiHostProjectList
        environments={[
          bucket({ environmentId: 'desktop', connectionId: 'local', label: 'This Mac', kind: 'local', checkouts: [local] }),
          bucket({ environmentId: 'node-1', connectionId: 'cli-1', label: 'build', checkouts: [remote] }),
        ]}
        groupBy="project"
        sort="recent"
        expandedProjectKeys={new Set()}
        collapsedEnvironmentIds={[]}
        folderSessions={{}}
        folderSessionsHaveMore={{}}
        loadingFolders={{}}
        openingSession={null}
        onToggleProject={vi.fn()}
        onToggleEnvironment={vi.fn()}
        onLoadMoreSessions={vi.fn(async () => [])}
        onSwitchSession={vi.fn()}
        onPinSession={vi.fn()}
        onHideSession={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onEditProject={vi.fn()}
        onRemoveProject={vi.fn()}
        onNewSession={vi.fn()}
        onRefreshEnvironment={vi.fn()}
        onToggleConnection={vi.fn()}
        onAddProject={vi.fn()}
        connectionBusyId={null}
        refreshingConnectionId={null}
      />,
    )
    const row = screen.getByText('app').closest('.h-9')
    expectSharedSlot(row, '.lucide-folder', 'size-4')
    const actions = row?.querySelector('[data-slot="project-row-actions"]')
    expect(actions?.getAttribute('class')).toContain('opacity-0')
    expect(actions?.querySelector('[aria-label="New Session"]')).not.toBeNull()
    expect(actions?.querySelector('[aria-label="Search sessions…"]')).not.toBeNull()
  })

  it('keeps a disconnected environment and its project collapsed', () => {
    const onToggleEnvironment = vi.fn()
    const onToggleProject = vi.fn()
    const remote = checkout({
      environmentId: 'node-1',
      connectionId: 'cli-1',
      projectId: 'p2',
      name: 'remote-app',
      pathKey: 'remote:cli-1:/srv/app',
      hostPath: '/srv/app',
    })
    const listProps = {
      sort: 'recent' as const,
      expandedProjectKeys: new Set(['remote:cli-1:/srv/app']),
      collapsedEnvironmentIds: [],
      folderSessions: {
        'remote:cli-1:/srv/app': [{ sessionId: 's1', title: 'Remote session', lastActiveAt: '0', messageCount: 1 }],
      },
      folderSessionsHaveMore: {},
      loadingFolders: {},
      openingSession: null,
      onToggleProject,
      onToggleEnvironment,
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
      environments: [
        bucket({
          environmentId: 'node-1',
          connectionId: 'cli-1',
          label: 'build',
          connection: 'offline',
          checkouts: [remote],
        }),
      ],
    }
    const { rerender } = render(<MultiHostProjectList {...listProps} groupBy="environment" />)
    expect(screen.queryByText('remote-app')).toBeNull()
    expect(screen.queryByText('Remote session')).toBeNull()
    fireEvent.click(screen.getByText('build'))
    expect(onToggleEnvironment).not.toHaveBeenCalled()

    rerender(<MultiHostProjectList {...listProps} groupBy="project" />)
    fireEvent.click(screen.getByText('remote-app'))
    expect(onToggleProject).not.toHaveBeenCalled()
    expect(screen.queryByText('Remote session')).toBeNull()
    expect(screen.getByText('remote-app').closest('.h-9')?.querySelector('.lucide-chevron-right')?.getAttribute('class')).toContain('!hidden')

    const other = checkout({
      environmentId: 'node-2',
      connectionId: 'cli-2',
      projectId: 'p3',
      name: 'remote-app',
      pathKey: 'remote:cli-2:/srv/app',
      hostPath: '/srv/app',
      lastOpened: 1,
    })
    rerender(
      <MultiHostProjectList
        {...listProps}
        groupBy="project"
        expandedProjectKeys={new Set(['group:repo:github.com/acme/app.git'])}
        environments={[
          bucket({ environmentId: 'node-1', connectionId: 'cli-1', label: 'build', connection: 'offline', checkouts: [remote] }),
          bucket({ environmentId: 'node-2', connectionId: 'cli-2', label: 'other', connection: 'offline', checkouts: [other] }),
        ]}
      />,
    )
    fireEvent.click(screen.getByText('remote-app'))
    expect(onToggleProject).not.toHaveBeenCalled()
    expect(screen.getByText('remote-app').closest('button')).toBeNull()
  })
})
