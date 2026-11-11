/** @vitest-environment jsdom */
import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectRef } from '@superone/shared/environment'
import type { EnvironmentBucket, HostCheckout } from '@/lib/multi-host/types'
import { MultiHostEnvironmentScroll } from './MultiHostEnvironmentScroll'
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
  onSwitchSession: vi.fn(),
  onPinSession: vi.fn(),
  onSettleSession: vi.fn(),
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

  it('lists each device without a painted name bar', () => {
    renderList()

    expect(screen.queryByText('Projects')).toBeNull()
    const header = document.querySelector('[data-environment-id="desktop"] > [data-slot="environment-section-header"]')
    expect(header?.className ?? '').not.toContain('sticky')
    expect(header?.className ?? '').not.toContain('bg-')
    const row = screen.getByText('This Mac').closest('.group')
    expect(row).toBeInstanceOf(HTMLElement)
    expect(row?.className).toContain('hover:bg-sidebar-hover')
    expect(row?.className).toContain('data-[sidebar-hover-open=true]:bg-sidebar-hover')
    expect(row?.className).toContain('h-9')
    expect(row?.className).toContain('px-1.5')
    expect(header).toContainElement(row as HTMLElement)
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

  it('gives a long device the leftover pane and grows its sessions', () => {
    const sessions = Array.from({ length: 20 }, (_, index) => ({
      sessionId: `s${index}`,
      title: `Session ${index}`,
      lastActiveAt: '2026-10-09T00:00:00.000Z',
      messageCount: 1,
    }))
    renderList({
      paneHeight: 640,
      sectionSizes: new Map([
        ['desktop', { fixedPx: 36, sessions: [{ key: local.pathKey, contentPx: 640 }] }],
        ['node-1', { fixedPx: 36, sessions: [] }],
      ]),
      expandedProjectKeys: new Set([local.pathKey]),
      folderSessions: { [local.pathKey]: sessions },
    })

    const localList = document.querySelector<HTMLElement>('[data-environment-id="desktop"] [data-environment-project-list]')
    const sessionList = document.querySelector<HTMLElement>('[data-active-session-list]')
    expect(localList).toHaveClass('max-h-64')
    expect(localList?.style.maxHeight).toBe(`${640 - 36 * 2 - 36}px`)
    expect(sessionList).toHaveClass('max-h-64')
    expect(sessionList?.style.maxHeight).toBe(`${640 - 36 * 2 - 36 - 36}px`)
  })

  it('stays on the shared cap until device contents are measured', () => {
    const projects = (environmentId: string, count: number) => Array.from({ length: count }, (_, index) => checkout({
      environmentId,
      connectionId: environmentId === 'desktop' ? 'local' : 'cli-1',
      projectId: `${environmentId}-${index}`,
      name: `${environmentId}-${index}`,
      pathKey: `/${environmentId}/${index}`,
      hostPath: `/${environmentId}/${index}`,
    }))
    renderList({
      paneHeight: 900,
      environments: [
        bucket({ environmentId: 'desktop', connectionId: 'local', label: 'This Mac', kind: 'local', checkouts: projects('desktop', 14) }),
        bucket({ environmentId: 'node-1', connectionId: 'cli-1', label: 'build', checkouts: projects('node-1', 10) }),
      ],
    })

    for (const id of ['desktop', 'node-1']) {
      const list = document.querySelector<HTMLElement>(`[data-environment-id="${id}"] [data-environment-project-list]`)
      expect(list).toHaveClass('max-h-64')
      expect(list?.style.maxHeight ?? '').toBe('')
    }
  })

  it('hides an offline environment\'s projects', () => {
    localStorage.clear()
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
    expect(screen.queryByRole('button', { name: /Offline/ })).toBeNull()
  })

  it('leaves offline hosts out of the pane so the open device can use it', () => {
    localStorage.clear()
    const projects = Array.from({ length: 14 }, (_, index) => checkout({
      environmentId: 'desktop',
      connectionId: 'local',
      projectId: `desktop-${index}`,
      name: `desktop-${index}`,
      pathKey: `/desktop/${index}`,
      hostPath: `/desktop/${index}`,
    }))
    renderList({
      paneHeight: 640,
      sectionSizes: new Map([['desktop', { fixedPx: 14 * 36, sessions: [] }]]),
      environments: [
        bucket({ environmentId: 'desktop', connectionId: 'local', label: 'This Mac', kind: 'local', checkouts: projects }),
        ...['alpha', 'beta', 'gamma', 'delta'].map((label) => bucket({
          environmentId: label,
          connectionId: label,
          label,
          connection: 'offline',
          projectsStatus: 'idle',
        })),
      ],
    })

    expect(screen.queryByText('alpha')).toBeNull()
    const list = document.querySelector<HTMLElement>('[data-environment-id="desktop"] [data-environment-project-list]')
    expect(list?.style.maxHeight).toBe(`${640 - 36}px`)
  })

  it('anchors the offline group under the host scroll', () => {
    localStorage.clear()
    const { container } = render(
      <MultiHostEnvironmentScroll
        environments={[
          bucket({ environmentId: 'desktop', connectionId: 'local', label: 'This Mac', kind: 'local', checkouts: [local] }),
          bucket({ environmentId: 'alpha', connectionId: 'alpha', label: 'alpha', connection: 'offline', projectsStatus: 'idle' }),
          bucket({ environmentId: 'beta', connectionId: 'beta', label: 'beta', connection: 'offline', projectsStatus: 'idle' }),
        ]}
        groupBy="environment"
        sort="recent"
        expandedProjectKeys={new Set()}
        collapsedEnvironmentIds={[]}
        folderSessions={{}}
        loadingFolders={{}}
        openingSession={null}
        {...callbacks}
      />,
    )

    const viewport = container.querySelector('[data-slot="scroll-area-viewport"]')
    const group = container.querySelector('[data-offline-environment-group]')
    expect(group).not.toBeNull()
    expect(group).toHaveClass('shrink-0')
    expect(group).not.toHaveClass('max-h-[50%]')
    expect(viewport?.contains(group)).toBe(false)
    expect(viewport!.compareDocumentPosition(group!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const heading = screen.getByRole('button', { name: /Offline/ })
    expect(heading).toHaveAttribute('aria-expanded', 'false')
    expect(heading.querySelector('[data-slot="section-count"]')).toHaveTextContent('2')
    fireEvent.click(heading)
    expect(group?.querySelector('[data-offline-environment-list]')).toHaveClass('max-h-64')
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.getByText('beta')).toBeTruthy()
    expect(viewport?.contains(screen.getByText('alpha'))).toBe(false)
  })
})
