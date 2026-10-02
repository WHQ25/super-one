/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectSelector } from './ProjectSelector'
import type { RecentFolder } from '@superone/shared/agent-types'

const hostProjects = vi.fn()

vi.mock('@/hooks/use-host-projects', () => ({
  useHostProjects: () => hostProjects(),
}))

const selectProject = vi.fn().mockResolvedValue(undefined)
const fetchRecentFolders = vi.fn().mockResolvedValue(undefined)

let currentFolder = 'remote:env-1:/work/app'

vi.mock('@/stores/app', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ currentFolder, selectProject, fetchRecentFolders }),
}))

function remoteFolder(name: string, missing?: boolean): RecentFolder {
  return {
    id: name,
    path: `remote:env-1:/work/${name}`,
    name,
    ...(missing ? { missing: true } : {}),
    addedAt: new Date(0).toISOString(),
    lastOpened: new Date(0).toISOString(),
  }
}

function openMenu() {
  const trigger = screen.getByRole('button')
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  fireEvent.click(trigger)
}

beforeEach(() => {
  hostProjects.mockReset()
  window.app.getAppSettings = vi.fn().mockResolvedValue({ defaultClonePaths: {} })
})

describe('ProjectSelector remote empty states', () => {
  it('surfaces the host error with a retry instead of a blank menu', async () => {
    const refresh = vi.fn()
    hostProjects.mockReturnValue({
      connectionId: 'env-1',
      isLocal: false,
      projects: [],
      loading: false,
      error: 'gateway not ready',
      refresh,
    })

    render(<ProjectSelector />)
    openMenu()

    await waitFor(() => {
      expect(screen.getByText('gateway not ready')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('menuitem', { name: /retry/i }))
    expect(refresh).toHaveBeenCalled()
  })

  it('lists stale projects as disabled rows rather than hiding them', async () => {
    hostProjects.mockReturnValue({
      connectionId: 'env-1',
      isLocal: false,
      projects: [remoteFolder('gone', true)],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    render(<ProjectSelector />)
    openMenu()

    await waitFor(() => {
      expect(screen.getByText('gone')).toBeInTheDocument()
    })
    expect(screen.queryByText(/no projects/i)).not.toBeInTheDocument()
  })

  it('says the host has no projects when the list is genuinely empty', async () => {
    hostProjects.mockReturnValue({
      connectionId: 'env-1',
      isLocal: false,
      projects: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    render(<ProjectSelector />)
    openMenu()

    await waitFor(() => {
      expect(screen.getByText(/no projects/i)).toBeInTheDocument()
    })
  })
})


describe('ProjectSelector add-project flow', () => {
  it.each(['local', 'env-1'])('opens the shared dialog and selects the added project on %s', async (connectionId) => {
    const isLocal = connectionId === 'local'
    hostProjects.mockReturnValue({ connectionId, isLocal, projects: [], loading: false, error: null, refresh: vi.fn() })
    const openProject = vi.fn().mockResolvedValue({ projectId: 'new-project', path: '/work/new', name: 'new' })
    window.environment = {
      listItems: vi.fn().mockResolvedValue([]),
      browsePath: vi.fn().mockResolvedValue({ path: '/work/new', entries: [] }),
      openProject,
    } as unknown as typeof window.environment
    selectProject.mockClear()
    fetchRecentFolders.mockClear()
    const onOpened = vi.fn()
    render(<ProjectSelector carryOpenDraft onOpened={onOpened} />)
    openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: /add project/i }))
    const input = await screen.findByRole('textbox')
    expect(selectProject).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '/work/new/' } })
    await waitFor(() => expect(window.environment.browsePath).toHaveBeenCalled())
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    await waitFor(() => expect(selectProject).toHaveBeenCalledWith(
      isLocal ? '/work/new' : 'remote:env-1:/work/new',
      { connectionId, projectId: 'new-project', carryOpenDraft: true },
    ))
    await waitFor(() => expect(onOpened).toHaveBeenCalledOnce())
    expect(fetchRecentFolders).toHaveBeenCalledTimes(isLocal ? 1 : 0)
  })

  it('opens the shared dialog from the empty compact selector', async () => {
    currentFolder = ''
    hostProjects.mockReturnValue({ connectionId: 'local', isLocal: true, projects: [], loading: false, error: null, refresh: vi.fn() })
    render(<ProjectSelector compact />)
    fireEvent.click(screen.getByRole('button', { name: /add project/i }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    currentFolder = 'remote:env-1:/work/app'
  })
})
