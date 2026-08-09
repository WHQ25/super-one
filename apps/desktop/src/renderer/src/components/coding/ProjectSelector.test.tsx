/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectSelector } from './ProjectSelector'
import type { RecentFolder } from '@superone/shared/agent-types'

const hostProjects = vi.fn()

vi.mock('@/hooks/use-host-projects', () => ({
  useHostProjects: () => hostProjects(),
}))

const currentFolder = 'remote:env-1:/work/app'

vi.mock('@/stores/app', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ currentFolder, selectProject: vi.fn().mockResolvedValue(undefined) }),
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
