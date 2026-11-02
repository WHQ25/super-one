/** @vitest-environment jsdom */
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EnvironmentBucket } from '@/lib/multi-host/types'
import { applySidebarFocus, focusEnvironment } from './sidebar-focus'
import { SidebarFocusView } from './SidebarFocusView'

const environment: EnvironmentBucket = {
  environmentId: 'env-1',
  connectionId: 'local',
  label: 'Build machine',
  kind: 'local',
  connection: 'connected',
  projectsStatus: 'ready',
  projectsError: null,
  checkouts: [],
}

afterEach(() => {
  applySidebarFocus(null)
})

describe('SidebarFocusView', () => {
  it('places the focused object’s pinned sessions and drafts under the focus bar', () => {
    focusEnvironment(environment.environmentId)
    render(
      <SidebarFocusView
        environments={[environment]}
        sort="recent"
        expandedProjectKeys={new Set()}
        folders={[]}
        localHostLabel="This Mac"
        folderSessions={{}}
        loadingFolders={{}}
        openingSession={null}
        connectionBusyId={null}
        refreshingConnectionId={null}
        onLoadFolderSessions={vi.fn()}
        onLoadMoreSessions={vi.fn()}
        onToggleProject={vi.fn()}
        onSwitchSession={vi.fn()}
        onPinSession={vi.fn()}
        onSettleSession={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onEditProject={vi.fn()}
        onRemoveProject={vi.fn()}
        onNewSession={vi.fn()}
        onRefreshEnvironment={vi.fn()}
        onToggleConnection={vi.fn()}
        onAddProject={vi.fn()}
        belowBar={<div>Pinned and drafts</div>}
      />,
    )

    const focus = document.querySelector('[data-sidebar-focus]')
    const bar = focus?.querySelector('[data-sidebar-focus-bar]')
    const context = focus?.querySelector('[data-sidebar-focus-context]')
    const projects = focus?.querySelector('[data-environment-id]')
    expect(bar).toBeTruthy()
    expect(context).toBeTruthy()
    expect(projects).toBeTruthy()
    if (!bar || !context || !projects) return
    expect(context).toHaveTextContent('Pinned and drafts')
    expect(bar.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(context.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
