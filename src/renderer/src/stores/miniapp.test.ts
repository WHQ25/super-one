/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MiniAppEntry } from '../../../shared/miniapp-types'

const { mockSetSidebarTab, mockSetLayoutMode, mockOpenMiniAppTab } = vi.hoisted(() => ({
  mockSetSidebarTab: vi.fn(),
  mockSetLayoutMode: vi.fn(),
  mockOpenMiniAppTab: vi.fn(),
}))

vi.mock('./app', () => ({
  useAppStore: {
    getState: () => ({
      setSidebarTab: mockSetSidebarTab,
      setLayoutMode: mockSetLayoutMode,
    }),
  },
}))

vi.mock('@/components/activity/activity-panel-api', () => ({
  openMiniAppTab: mockOpenMiniAppTab,
}))

let capturedHandler:
  | ((projectDir: string, appId: string) => Promise<void> | void)
  | null = null

const mockMiniapp = {
  onDevAppReady: vi.fn((cb: (projectDir: string, appId: string) => void) => {
    capturedHandler = cb
    return () => {}
  }),
  list: vi.fn<(projectDir?: string) => Promise<MiniAppEntry[]>>(),
  open: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  preview: vi.fn(),
  confirmInstall: vi.fn(),
  cancelInstall: vi.fn(),
  uninstall: vi.fn(),
}

;(globalThis as unknown as { window: typeof window }).window =
  globalThis as unknown as typeof window
;(window as unknown as { miniapp: typeof mockMiniapp }).miniapp = mockMiniapp

function entry(id: string, type: 'panel' | 'sidebar' | 'fullscreen'): MiniAppEntry {
  return {
    id,
    installDir: `/install/${id}`,
    manifest: { appId: id, name: `App ${id}`, type },
  }
}

const APPS: MiniAppEntry[] = [
  entry('panel-app', 'panel'),
  entry('sidebar-app', 'sidebar'),
  entry('fullscreen-app', 'fullscreen'),
]

let useMiniAppStore: typeof import('./miniapp').useMiniAppStore

beforeEach(async () => {
  vi.clearAllMocks()
  capturedHandler = null
  mockMiniapp.list.mockResolvedValue(APPS)

  vi.resetModules()
  ;({ useMiniAppStore } = await import('./miniapp'))

  await useMiniAppStore.getState().refreshApps('/proj')
})

describe('miniapp store onDevAppReady routing', () => {
  it('registers a handler at module load time', () => {
    expect(mockMiniapp.onDevAppReady).toHaveBeenCalledTimes(1)
    expect(typeof capturedHandler).toBe('function')
  })

  it('opens only the signaled panel app, not other dev apps in the list', async () => {
    await capturedHandler!('/proj', 'panel-app')

    expect(mockMiniapp.open).toHaveBeenCalledTimes(1)
    expect(mockMiniapp.open).toHaveBeenCalledWith('panel-app', '/proj')
    expect(mockOpenMiniAppTab).toHaveBeenCalledTimes(1)
    expect(mockOpenMiniAppTab).toHaveBeenCalledWith('panel-app', 'App panel-app')
    expect(mockSetSidebarTab).not.toHaveBeenCalled()
    expect(mockSetLayoutMode).not.toHaveBeenCalled()
  })

  it('routes a sidebar app to setSidebarTab and nothing else', async () => {
    await capturedHandler!('/proj', 'sidebar-app')

    expect(mockSetSidebarTab).toHaveBeenCalledTimes(1)
    expect(mockSetSidebarTab).toHaveBeenCalledWith('miniapp:sidebar-app')
    expect(mockMiniapp.open).not.toHaveBeenCalled()
    expect(mockOpenMiniAppTab).not.toHaveBeenCalled()
    expect(mockSetLayoutMode).not.toHaveBeenCalled()
  })

  it('routes a fullscreen app to canvas mode + requestOpenInCanvas', async () => {
    await capturedHandler!('/proj', 'fullscreen-app')

    expect(mockSetLayoutMode).toHaveBeenCalledWith('canvas')
    expect(useMiniAppStore.getState().pendingOpenAppId).toBe('fullscreen-app')
    expect(mockMiniapp.open).not.toHaveBeenCalled()
    expect(mockOpenMiniAppTab).not.toHaveBeenCalled()
    expect(mockSetSidebarTab).not.toHaveBeenCalled()
  })

  it('does nothing when the signaled appId is not in the refreshed list', async () => {
    await capturedHandler!('/proj', 'never-existed')

    expect(mockMiniapp.open).not.toHaveBeenCalled()
    expect(mockOpenMiniAppTab).not.toHaveBeenCalled()
    expect(mockSetSidebarTab).not.toHaveBeenCalled()
    expect(mockSetLayoutMode).not.toHaveBeenCalled()
  })

  it('refreshes apps before routing so a freshly-scaffolded appId is found', async () => {
    const fresh = entry('fresh-app', 'panel')
    mockMiniapp.list.mockResolvedValueOnce([...APPS, fresh])

    await capturedHandler!('/proj', 'fresh-app')

    expect(mockMiniapp.list).toHaveBeenLastCalledWith('/proj')
    expect(mockMiniapp.open).toHaveBeenCalledWith('fresh-app', '/proj')
    expect(mockOpenMiniAppTab).toHaveBeenCalledWith('fresh-app', 'App fresh-app')
  })

  it('signaling one app among many opens exactly one (regression: old code opened all dev apps)', async () => {
    await capturedHandler!('/proj', 'sidebar-app')

    const totalOpenSideEffects =
      mockMiniapp.open.mock.calls.length +
      mockSetSidebarTab.mock.calls.length +
      mockSetLayoutMode.mock.calls.length
    expect(totalOpenSideEffects).toBe(1)
  })

  it('falls back to provided projectDir when _lastProjectDir is undefined', async () => {
    vi.resetModules()
    mockMiniapp.list.mockClear()
    mockMiniapp.list.mockResolvedValue(APPS)
    capturedHandler = null
    ;({ useMiniAppStore } = await import('./miniapp'))

    await capturedHandler!('/fallback-proj', 'panel-app')

    expect(mockMiniapp.list).toHaveBeenCalledWith('/fallback-proj')
  })

  it('defaults missing manifest.type to panel', async () => {
    const noType: MiniAppEntry = {
      id: 'no-type-app',
      installDir: '/install/no-type-app',
      manifest: { appId: 'no-type-app', name: 'No Type' },
    }
    mockMiniapp.list.mockResolvedValueOnce([noType])

    await capturedHandler!('/proj', 'no-type-app')

    expect(mockMiniapp.open).toHaveBeenCalledWith('no-type-app', '/proj')
  })
})
