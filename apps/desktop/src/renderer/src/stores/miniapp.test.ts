/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'

const { mockSetLayoutMode, mockOpenMiniAppTab, mockCloseMiniAppTab, mockSetPanelWidth, appStateRef } = vi.hoisted(() => ({
  mockSetLayoutMode: vi.fn(),
  mockOpenMiniAppTab: vi.fn(),
  mockCloseMiniAppTab: vi.fn(),
  mockSetPanelWidth: vi.fn(),
  appStateRef: { showSidebar: true, sidebarWidth: 320 } as { showSidebar: boolean; sidebarWidth: number },
}))

vi.mock('./app', () => ({
  useAppStore: {
    getState: () => ({
      setLayoutMode: mockSetLayoutMode,
      showSidebar: appStateRef.showSidebar,
      sidebarWidth: appStateRef.sidebarWidth,
    }),
  },
}))

vi.mock('./activity-panel', () => ({
  useActivityPanelStore: {
    getState: () => ({ setPanelWidth: mockSetPanelWidth }),
  },
}))

vi.mock('@/components/activity/activity-panel-api', () => ({
  openMiniAppTab: mockOpenMiniAppTab,
  closeMiniAppTab: mockCloseMiniAppTab,
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

function entry(id: string, fullscreen?: boolean, preferWidth?: number): MiniAppEntry {
  return {
    id,
    installDir: `/install/${id}`,
    manifest: {
      appId: id,
      name: `App ${id}`,
      ...(fullscreen && { fullscreen: true }),
      ...(preferWidth != null && { preferWidth }),
    },
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
  appStateRef.showSidebar = true
  appStateRef.sidebarWidth = 320
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 })
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

describe('miniapp store lifecycle (persistent iframe)', () => {
  it('openAppInPanel registers app and triggers MINIAPP_OPEN exactly once', async () => {
    const fullscreenApp = entry('fullscreen-app', true)
    await useMiniAppStore.getState().openAppInPanel(fullscreenApp, '/proj')

    expect(mockMiniapp.open).toHaveBeenCalledTimes(1)
    expect(mockMiniapp.open).toHaveBeenCalledWith('fullscreen-app', '/proj')
    expect(mockOpenMiniAppTab).toHaveBeenCalledWith('fullscreen-app', 'App fullscreen-app')

    const open = useMiniAppStore.getState().openApps['fullscreen-app']
    expect(open).toBeDefined()
    expect(open?.presentation).toBe('panel')
    expect(open?.projectDir).toBe('/proj')
  })

  it('opening an already-open app focuses the tab without re-opening', async () => {
    const fullscreenApp = entry('fullscreen-app', true)
    await useMiniAppStore.getState().openAppInPanel(fullscreenApp, '/proj')
    mockMiniapp.open.mockClear()
    mockOpenMiniAppTab.mockClear()

    await useMiniAppStore.getState().openAppInPanel(fullscreenApp, '/proj')

    expect(mockMiniapp.open).not.toHaveBeenCalled()
    expect(mockOpenMiniAppTab).toHaveBeenCalledTimes(1)
  })

  it('moveAppToCanvas flips presentation without calling MINIAPP_OPEN or MINIAPP_CLOSE', async () => {
    const app = entry('fullscreen-app', true)
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')
    mockMiniapp.open.mockClear()
    mockMiniapp.close.mockClear()
    mockOpenMiniAppTab.mockClear()
    mockCloseMiniAppTab.mockClear()

    useMiniAppStore.getState().moveAppToCanvas('fullscreen-app')

    expect(mockMiniapp.open).not.toHaveBeenCalled()
    expect(mockMiniapp.close).not.toHaveBeenCalled()
    expect(mockCloseMiniAppTab).toHaveBeenCalledWith('fullscreen-app')
    expect(mockSetLayoutMode).toHaveBeenLastCalledWith('canvas')

    const open = useMiniAppStore.getState().openApps['fullscreen-app']
    expect(open?.presentation).toBe('canvas')
    expect(useMiniAppStore.getState().fullscreenApp?.appId).toBe('fullscreen-app')
  })

  it('moveAppToPanel flips presentation without calling MINIAPP_OPEN or MINIAPP_CLOSE', async () => {
    const app = entry('fullscreen-app', true)
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')
    useMiniAppStore.getState().moveAppToCanvas('fullscreen-app')
    mockMiniapp.open.mockClear()
    mockMiniapp.close.mockClear()
    mockOpenMiniAppTab.mockClear()
    mockSetLayoutMode.mockClear()

    useMiniAppStore.getState().moveAppToPanel('fullscreen-app')

    expect(mockMiniapp.open).not.toHaveBeenCalled()
    expect(mockMiniapp.close).not.toHaveBeenCalled()
    expect(mockOpenMiniAppTab).toHaveBeenCalledWith('fullscreen-app', 'App fullscreen-app')
    expect(mockSetLayoutMode).toHaveBeenCalledWith('coding')

    const open = useMiniAppStore.getState().openApps['fullscreen-app']
    expect(open?.presentation).toBe('panel')
    expect(useMiniAppStore.getState().fullscreenApp).toBeNull()
  })

  it('panel → canvas → panel preserves openApps and calls open/close zero extra times', async () => {
    const app = entry('fullscreen-app', true)
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')
    expect(mockMiniapp.open).toHaveBeenCalledTimes(1)

    useMiniAppStore.getState().moveAppToCanvas('fullscreen-app')
    useMiniAppStore.getState().moveAppToPanel('fullscreen-app')

    expect(mockMiniapp.open).toHaveBeenCalledTimes(1)
    expect(mockMiniapp.close).not.toHaveBeenCalled()

    const open = useMiniAppStore.getState().openApps['fullscreen-app']
    expect(open?.presentation).toBe('panel')
  })

  it('closeApp removes app from openApps and triggers MINIAPP_CLOSE', async () => {
    const app = entry('panel-app')
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')
    mockMiniapp.close.mockClear()
    mockCloseMiniAppTab.mockClear()

    await useMiniAppStore.getState().closeApp('panel-app')

    expect(mockMiniapp.close).toHaveBeenCalledWith('panel-app')
    expect(mockCloseMiniAppTab).toHaveBeenCalledWith('panel-app')
    expect(useMiniAppStore.getState().openApps['panel-app']).toBeUndefined()
  })

  it('closing a canvas app switches layoutMode back to coding', async () => {
    const app = entry('fullscreen-app', true)
    await useMiniAppStore.getState().openFullscreenApp(app, '/proj')
    mockSetLayoutMode.mockClear()

    await useMiniAppStore.getState().closeApp('fullscreen-app')

    expect(mockSetLayoutMode).toHaveBeenCalledWith('coding')
    expect(useMiniAppStore.getState().fullscreenApp).toBeNull()
  })

  it('handlePanelRemoved closes app when not migrating (real user X click)', async () => {
    const app = entry('panel-app')
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')
    mockMiniapp.close.mockClear()

    useMiniAppStore.getState().handlePanelRemoved('panel-app')
    await Promise.resolve()
    await Promise.resolve()

    expect(mockMiniapp.close).toHaveBeenCalledWith('panel-app')
    expect(useMiniAppStore.getState().openApps['panel-app']).toBeUndefined()
  })

  it('uninstallApp closes an open instance first so MINIAPP_CLOSE fires before delete', async () => {
    const app = entry('panel-app')
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')
    const callOrder: string[] = []
    mockMiniapp.close.mockImplementationOnce(async () => { callOrder.push('close') })
    mockMiniapp.uninstall.mockImplementationOnce(async () => { callOrder.push('uninstall') })

    await useMiniAppStore.getState().uninstallApp('panel-app')

    expect(callOrder).toEqual(['close', 'uninstall'])
    expect(useMiniAppStore.getState().openApps['panel-app']).toBeUndefined()
  })

  it('uninstallApp skips the close step when the app is not currently open', async () => {
    mockMiniapp.close.mockClear()
    await useMiniAppStore.getState().uninstallApp('panel-app')

    expect(mockMiniapp.close).not.toHaveBeenCalled()
    expect(mockMiniapp.uninstall).toHaveBeenCalledWith('panel-app', undefined)
  })

  it('uninstallApp forwards installDir so a project-scope app can be removed', async () => {
    mockMiniapp.uninstall.mockClear()
    const projectInstallDir = '/proj/.superone/apps/panel-app'

    await useMiniAppStore.getState().uninstallApp('panel-app', projectInstallDir)

    expect(mockMiniapp.uninstall).toHaveBeenCalledWith('panel-app', projectInstallDir)
  })

  it('handlePanelRemoved suppresses close during a migration (consumes _migratingApps)', async () => {
    const app = entry('fullscreen-app', true)
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')

    useMiniAppStore.getState().moveAppToCanvas('fullscreen-app')
    mockMiniapp.close.mockClear()

    expect(useMiniAppStore.getState()._migratingApps.has('fullscreen-app')).toBe(true)

    useMiniAppStore.getState().handlePanelRemoved('fullscreen-app')

    expect(useMiniAppStore.getState()._migratingApps.has('fullscreen-app')).toBe(false)
    expect(mockMiniapp.close).not.toHaveBeenCalled()
    expect(useMiniAppStore.getState().openApps['fullscreen-app']).toBeDefined()
  })
})

describe('miniapp store preferWidth', () => {
  it('applies preferWidth to activity panel when fits', async () => {
    const app = entry('panel-app', false, 480)
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')

    expect(mockSetPanelWidth).toHaveBeenCalledTimes(1)
    expect(mockSetPanelWidth).toHaveBeenCalledWith(480)
  })

  it('clamps preferWidth to available space when room is tight', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1100 })
    appStateRef.sidebarWidth = 320
    const app = entry('panel-app', false, 800)

    await useMiniAppStore.getState().openAppInPanel(app, '/proj')

    expect(mockSetPanelWidth).toHaveBeenCalledTimes(1)
    expect(mockSetPanelWidth).toHaveBeenCalledWith(380)
  })

  it('skips applying when there is no room (max < MIN_AP)', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 })
    appStateRef.sidebarWidth = 320
    const app = entry('panel-app', false, 480)

    await useMiniAppStore.getState().openAppInPanel(app, '/proj')

    expect(mockSetPanelWidth).not.toHaveBeenCalled()
  })

  it('does not apply preferWidth when re-opening an already-open app (focus only)', async () => {
    const app = entry('panel-app', false, 480)
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')
    expect(mockSetPanelWidth).toHaveBeenCalledTimes(1)
    mockSetPanelWidth.mockClear()

    await useMiniAppStore.getState().openAppInPanel(app, '/proj')

    expect(mockSetPanelWidth).not.toHaveBeenCalled()
  })

  it('does not call setPanelWidth when preferWidth is unset', async () => {
    const app = entry('panel-app')
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')

    expect(mockSetPanelWidth).not.toHaveBeenCalled()
  })

  it('uses extra room when sidebar is hidden', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
    appStateRef.showSidebar = false
    const app = entry('panel-app', false, 800)

    await useMiniAppStore.getState().openAppInPanel(app, '/proj')

    expect(mockSetPanelWidth).toHaveBeenCalledWith(600)
  })
})

describe('miniapp store slots', () => {
  it('updateSlot records rect and unregisterSlot clears it', () => {
    const rect = { left: 10, top: 20, width: 300, height: 400 } as DOMRectReadOnly
    useMiniAppStore.getState().updateSlot('panel-app', 'panel', rect)

    const slot = useMiniAppStore.getState().slots['panel-app']
    expect(slot).toEqual({ mode: 'panel', left: 10, top: 20, width: 300, height: 400 })

    useMiniAppStore.getState().unregisterSlot('panel-app', 'panel')
    expect(useMiniAppStore.getState().slots['panel-app']).toBeUndefined()
  })

  it('unregisterSlot ignores stale mode (mode-mismatched call does not clear current slot)', () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 } as DOMRectReadOnly
    useMiniAppStore.getState().updateSlot('a', 'canvas', rect)

    useMiniAppStore.getState().unregisterSlot('a', 'panel')

    expect(useMiniAppStore.getState().slots['a']?.mode).toBe('canvas')
  })
})
