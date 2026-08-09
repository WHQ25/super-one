/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useHostProjects } from './use-host-projects'
import { useAppStore } from '@/stores/app'

const listItems = vi.fn()
const listProjects = vi.fn()
const connect = vi.fn()
let statusListener: ((snapshot: {
  connectionId: string
  state: string
  generation: number
}) => void) | null = null

beforeEach(() => {
  listItems.mockReset()
  listProjects.mockReset()
  connect.mockReset()
  statusListener = null
  listItems.mockResolvedValue([])
  listProjects.mockResolvedValue([])
  connect.mockResolvedValue(undefined)

  // Replace the vitest.setup Proxy so these methods are callable spies.
  ;(window as unknown as { environment: unknown }).environment = {
    listItems,
    listProjects,
    connect,
    onStatusEvent: (listener: typeof statusListener) => {
      statusListener = listener
      return () => { statusListener = null }
    },
  }

  useAppStore.setState({
    selectedHostConnectionId: 'local',
    recentFolders: [
      {
        id: 'local-1',
        path: '/Users/dev/local-app',
        name: 'local-app',
        lastOpened: new Date().toISOString(),
        addedAt: new Date().toISOString(),
      },
    ],
  })
})

describe('useHostProjects', () => {
  it('returns local recent folders when the selected host is local', () => {
    const { result } = renderHook(() => useHostProjects())
    expect(result.current.isLocal).toBe(true)
    expect(result.current.projects.map((p) => p.path)).toEqual(['/Users/dev/local-app'])
    expect(listProjects).not.toHaveBeenCalled()
  })

  it('loads remote projects when the selected host changes', async () => {
    listItems.mockResolvedValue([
      { connectionId: 'env-1', state: 'connected', label: 'lab' },
    ])
    listProjects.mockResolvedValue([
      {
        projectId: 'p1',
        path: '/work/remote-app',
        name: 'remote-app',
        lastActiveAt: 1_700_000_000_000,
      },
    ])

    const { result, rerender } = renderHook(() => useHostProjects())

    act(() => {
      useAppStore.setState({ selectedHostConnectionId: 'env-1' })
    })
    rerender()

    await waitFor(() => {
      expect(result.current.isLocal).toBe(false)
      expect(result.current.projects).toEqual([
        expect.objectContaining({
          id: 'p1',
          path: 'remote:env-1:/work/remote-app',
          name: 'remote-app',
        }),
      ])
    })

    expect(listProjects).toHaveBeenCalledWith('env-1')
    expect(connect).not.toHaveBeenCalled()
  })

  it('connects a disconnected remote host before listing projects', async () => {
    listItems.mockResolvedValue([
      { connectionId: 'env-2', state: 'disconnected', label: 'lab' },
    ])
    listProjects.mockResolvedValue([])

    const { result, rerender } = renderHook(() => useHostProjects())

    act(() => {
      useAppStore.setState({ selectedHostConnectionId: 'env-2' })
    })
    rerender()

    await waitFor(() => {
      expect(connect).toHaveBeenCalledWith('env-2')
      expect(listProjects).toHaveBeenCalledWith('env-2')
      expect(result.current.loading).toBe(false)
    })
  })

  it('preserves missing state for stale remote project records', async () => {
    listItems.mockResolvedValue([
      { connectionId: 'env-3', state: 'connected', label: 'lab' },
    ])
    listProjects.mockResolvedValue([
      {
        projectId: 'stale-1',
        path: '/old/project',
        name: 'old-project',
        missing: true,
      },
    ])

    const { result, rerender } = renderHook(() => useHostProjects())

    act(() => {
      useAppStore.setState({ selectedHostConnectionId: 'env-3' })
    })
    rerender()

    await waitFor(() => {
      expect(result.current.projects[0]).toEqual(
        expect.objectContaining({
          path: 'remote:env-3:/old/project',
          missing: true,
        }),
      )
    })
  })

  it('refreshes the selected host snapshot after a new connection generation', async () => {
    listItems.mockResolvedValue([
      { connectionId: 'env-4', state: 'connected', label: 'lab' },
    ])
    listProjects
      .mockResolvedValueOnce([
        { projectId: 'p1', path: '/work/first', name: 'first' },
      ])
      .mockResolvedValueOnce([
        { projectId: 'p2', path: '/work/reconnected', name: 'reconnected' },
      ])

    const { result, rerender } = renderHook(() => useHostProjects())
    act(() => {
      useAppStore.setState({ selectedHostConnectionId: 'env-4' })
    })
    rerender()

    await waitFor(() => {
      expect(result.current.projects[0]?.name).toBe('first')
    })

    act(() => {
      statusListener?.({ connectionId: 'env-4', state: 'connected', generation: 2 })
    })

    await waitFor(() => {
      expect(result.current.projects[0]?.name).toBe('reconnected')
    })
    expect(listProjects).toHaveBeenCalledTimes(2)
  })

  it('keeps the last known good list when a later refresh fails', async () => {
    listItems.mockResolvedValue([
      { connectionId: 'env-5', state: 'connected', label: 'lab' },
    ])
    listProjects
      .mockResolvedValueOnce([{ projectId: 'p1', path: '/work/keep', name: 'keep' }])
      .mockRejectedValueOnce(new Error('gateway not ready'))

    const { result, rerender } = renderHook(() => useHostProjects())
    act(() => {
      useAppStore.setState({ selectedHostConnectionId: 'env-5' })
    })
    rerender()

    await waitFor(() => {
      expect(result.current.projects[0]?.name).toBe('keep')
    })

    act(() => {
      statusListener?.({ connectionId: 'env-5', state: 'connected', generation: 2 })
    })

    // A transient failure must surface as an error, not blank the picker.
    await waitFor(() => {
      expect(result.current.error).toBe('gateway not ready')
    })
    expect(result.current.projects[0]?.name).toBe('keep')
  })

  it('retries when the selected host reaches a live state after a failed load', async () => {
    listItems.mockResolvedValue([
      { connectionId: 'env-6', state: 'synchronizing', label: 'lab' },
    ])
    listProjects
      .mockRejectedValueOnce(new Error('gateway not ready'))
      .mockResolvedValueOnce([{ projectId: 'p9', path: '/work/late', name: 'late' }])

    const { result, rerender } = renderHook(() => useHostProjects())
    act(() => {
      useAppStore.setState({ selectedHostConnectionId: 'env-6' })
    })
    rerender()

    await waitFor(() => {
      expect(result.current.error).toBe('gateway not ready')
    })

    act(() => {
      statusListener?.({ connectionId: 'env-6', state: 'synchronizing', generation: 2 })
    })

    await waitFor(() => {
      expect(result.current.projects[0]?.name).toBe('late')
      expect(result.current.error).toBeNull()
    })
  })

  it('forces a cache-bypassing reload when refresh is called with force', async () => {
    listItems.mockResolvedValue([
      { connectionId: 'env-9', state: 'connected', label: 'lab' },
    ])
    listProjects.mockResolvedValue([{ projectId: 'p1', path: '/work/a', name: 'a' }])

    const { result, rerender } = renderHook(() => useHostProjects())
    act(() => {
      useAppStore.setState({ selectedHostConnectionId: 'env-9' })
    })
    rerender()

    await waitFor(() => {
      expect(result.current.projects).toHaveLength(1)
    })
    listProjects.mockClear()

    act(() => {
      result.current.refresh({ force: true })
    })

    await waitFor(() => {
      expect(listProjects).toHaveBeenCalledWith('env-9', { refresh: true })
    })

    // A plain refresh must stay cache-friendly.
    listProjects.mockClear()
    act(() => {
      result.current.refresh()
    })
    await waitFor(() => {
      expect(listProjects).toHaveBeenCalledWith('env-9')
    })
  })

  it('skips loading while paused and loads once unpaused', async () => {
    listItems.mockResolvedValue([
      { connectionId: 'env-10', state: 'connected', label: 'lab' },
    ])
    listProjects.mockResolvedValue([{ projectId: 'p1', path: '/work/a', name: 'a' }])

    useAppStore.setState({ selectedHostConnectionId: 'env-10' })
    const { result, rerender } = renderHook(
      ({ paused }: { paused: boolean }) => useHostProjects({ paused }),
      { initialProps: { paused: true } },
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(listProjects).not.toHaveBeenCalled()

    rerender({ paused: false })

    await waitFor(() => {
      expect(result.current.projects).toHaveLength(1)
    })
  })

  it('reloads on any status change for the selected host', async () => {
    listItems.mockResolvedValue([
      { connectionId: 'env-11', state: 'connected', label: 'lab' },
    ])
    listProjects.mockResolvedValue([{ projectId: 'p1', path: '/work/a', name: 'a' }])

    const { result, rerender } = renderHook(() => useHostProjects())
    act(() => {
      useAppStore.setState({ selectedHostConnectionId: 'env-11' })
    })
    rerender()

    await waitFor(() => {
      expect(result.current.projects).toHaveLength(1)
    })
    listProjects.mockClear()

    // Sidebar parity: it re-ran on every supervisor snapshot, including the
    // edges that put a dropped host back on its feet.
    act(() => {
      statusListener?.({ connectionId: 'env-11', state: 'disconnected', generation: 2 })
    })

    await waitFor(() => {
      expect(listProjects).toHaveBeenCalledWith('env-11')
    })

    listProjects.mockClear()
    act(() => {
      statusListener?.({ connectionId: 'other-host', state: 'connected', generation: 3 })
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(listProjects).not.toHaveBeenCalled()
  })

  it('drops the previous host list when switching hosts', async () => {
    listItems.mockResolvedValue([
      { connectionId: 'env-7', state: 'connected', label: 'lab-a' },
      { connectionId: 'env-8', state: 'connected', label: 'lab-b' },
    ])
    listProjects
      .mockResolvedValueOnce([{ projectId: 'a1', path: '/work/a', name: 'host-a-project' }])
      .mockRejectedValueOnce(new Error('gateway not ready'))

    const { result, rerender } = renderHook(() => useHostProjects())
    act(() => {
      useAppStore.setState({ selectedHostConnectionId: 'env-7' })
    })
    rerender()

    await waitFor(() => {
      expect(result.current.projects[0]?.name).toBe('host-a-project')
    })

    act(() => {
      useAppStore.setState({ selectedHostConnectionId: 'env-8' })
    })
    rerender()

    await waitFor(() => {
      expect(result.current.error).toBe('gateway not ready')
    })
    expect(result.current.projects).toEqual([])
  })
})
