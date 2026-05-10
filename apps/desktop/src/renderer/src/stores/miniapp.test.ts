/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'

const { mockSetLayoutMode, mockOpenMiniAppTab } = vi.hoisted(() => ({
  mockSetLayoutMode: vi.fn(),
  mockOpenMiniAppTab: vi.fn(),
}))

vi.mock('./app', () => ({
  useAppStore: {
    getState: () => ({
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

function entry(id: string, fullscreen?: boolean): MiniAppEntry {
  return {
    id,
    installDir: `/install/${id}`,
    manifest: { appId: id, name: `App ${id}`, ...(fullscreen && { fullscreen: true }) },
  }
}

const APPS: MiniAppEntry[] = [
  entry('panel-app'),
  entry('fullscreen-app', true),
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
    expect(mockSetLayoutMode).not.toHaveBeenCalled()
  })

  it('also opens a fullscreen-capable app in the panel by default (fullscreen is a capability, not a default mode)', async () => {
    await capturedHandler!('/proj', 'fullscreen-app')

    expect(mockMiniapp.open).toHaveBeenCalledWith('fullscreen-app', '/proj')
    expect(mockOpenMiniAppTab).toHaveBeenCalledWith('fullscreen-app', 'App fullscreen-app')
    expect(mockSetLayoutMode).not.toHaveBeenCalled()
    expect(useMiniAppStore.getState().pendingOpenAppId).toBeNull()
  })

  it('does nothing when the signaled appId is not in the refreshed list', async () => {
    await capturedHandler!('/proj', 'never-existed')

    expect(mockMiniapp.open).not.toHaveBeenCalled()
    expect(mockOpenMiniAppTab).not.toHaveBeenCalled()
    expect(mockSetLayoutMode).not.toHaveBeenCalled()
  })

  it('refreshes apps before routing so a freshly-scaffolded appId is found', async () => {
    const fresh = entry('fresh-app')
    mockMiniapp.list.mockResolvedValueOnce([...APPS, fresh])

    await capturedHandler!('/proj', 'fresh-app')

    expect(mockMiniapp.list).toHaveBeenLastCalledWith('/proj')
    expect(mockMiniapp.open).toHaveBeenCalledWith('fresh-app', '/proj')
    expect(mockOpenMiniAppTab).toHaveBeenCalledWith('fresh-app', 'App fresh-app')
  })

  it('signaling one app among many opens exactly one (regression: old code opened all dev apps)', async () => {
    await capturedHandler!('/proj', 'fullscreen-app')

    expect(mockMiniapp.open).toHaveBeenCalledTimes(1)
    expect(mockOpenMiniAppTab).toHaveBeenCalledTimes(1)
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

  it('defaults a manifest without fullscreen to panel routing', async () => {
    const noFlag: MiniAppEntry = {
      id: 'no-flag-app',
      installDir: '/install/no-flag-app',
      manifest: { appId: 'no-flag-app', name: 'No Flag' },
    }
    mockMiniapp.list.mockResolvedValueOnce([noFlag])

    await capturedHandler!('/proj', 'no-flag-app')

    expect(mockMiniapp.open).toHaveBeenCalledWith('no-flag-app', '/proj')
  })
})
