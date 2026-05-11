/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'

const { mockSetLayoutMode, mockOpenMiniAppTab, mockCloseMiniAppTab, mockSetPanelWidth, mockIsInstanceReferenced, appStateRef } = vi.hoisted(() => ({
  mockSetLayoutMode: vi.fn(),
  mockOpenMiniAppTab: vi.fn(),
  mockCloseMiniAppTab: vi.fn(),
  mockSetPanelWidth: vi.fn(),
  mockIsInstanceReferenced: vi.fn<(instanceKey: string) => boolean>(),
  appStateRef: { showSidebar: true, sidebarWidth: 320, currentProjectId: 'proj-id-1' as string | null } as { showSidebar: boolean; sidebarWidth: number; currentProjectId: string | null },
}))

vi.mock('./activity-view-state', () => ({
  isInstanceReferencedInSavedSessions: mockIsInstanceReferenced,
}))

vi.mock('./app', () => ({
  useAppStore: {
    getState: () => ({
      setLayoutMode: mockSetLayoutMode,
      showSidebar: appStateRef.showSidebar,
      sidebarWidth: appStateRef.sidebarWidth,
      currentProjectId: appStateRef.currentProjectId,
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
let makeInstanceKey: typeof import('./miniapp').makeInstanceKey

beforeEach(async () => {
  vi.clearAllMocks()
  capturedHandler = null
  appStateRef.showSidebar = true
  appStateRef.sidebarWidth = 320
  appStateRef.currentProjectId = 'proj-id-1'
  mockIsInstanceReferenced.mockReturnValue(false)
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 })
  mockMiniapp.list.mockResolvedValue(APPS)

  vi.resetModules()
  ;({ useMiniAppStore, makeInstanceKey } = await import('./miniapp'))

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
    expect(mockOpenMiniAppTab).toHaveBeenCalledWith(makeInstanceKey('panel-app', 'proj-id-1'), 'panel-app', 'App panel-app')
    expect(mockSetLayoutMode).not.toHaveBeenCalled()
  })

  it('also opens a fullscreen-capable app in the panel by default (fullscreen is a capability, not a default mode)', async () => {
    await capturedHandler!('/proj', 'fullscreen-app')

    expect(mockMiniapp.open).toHaveBeenCalledWith('fullscreen-app', '/proj')
    expect(mockOpenMiniAppTab).toHaveBeenCalledWith(makeInstanceKey('fullscreen-app', 'proj-id-1'), 'fullscreen-app', 'App fullscreen-app')
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
    expect(mockOpenMiniAppTab).toHaveBeenCalledWith(makeInstanceKey('fresh-app', 'proj-id-1'), 'fresh-app', 'App fresh-app')
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
    ;({ useMiniAppStore, makeInstanceKey } = await import('./miniapp'))

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
  it('openAppInPanel registers app instance keyed by (appId, projectId) and triggers MINIAPP_OPEN exactly once', async () => {
    const fullscreenApp = entry('fullscreen-app', true)
    await useMiniAppStore.getState().openAppInPanel(fullscreenApp, '/proj')

    const key = makeInstanceKey('fullscreen-app', 'proj-id-1')
    expect(mockMiniapp.open).toHaveBeenCalledTimes(1)
    expect(mockMiniapp.open).toHaveBeenCalledWith('fullscreen-app', '/proj')
    expect(mockOpenMiniAppTab).toHaveBeenCalledWith(key, 'fullscreen-app', 'App fullscreen-app')

    const open = useMiniAppStore.getState().openApps[key]
    expect(open).toBeDefined()
    expect(open?.presentation).toBe('panel')
    expect(open?.projectDir).toBe('/proj')
    expect(open?.projectId).toBe('proj-id-1')
    expect(open?.instanceKey).toBe(key)
  })

  it('openAppInPanel captures the currentProjectId at open time so iframe origin stays stable across project switches', async () => {
    appStateRef.currentProjectId = 'project-A-id'
    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj-A')

    const key = makeInstanceKey('panel-app', 'project-A-id')
    const open = useMiniAppStore.getState().openApps[key]
    expect(open?.projectId).toBe('project-A-id')

    appStateRef.currentProjectId = 'project-B-id'
    const stillOpen = useMiniAppStore.getState().openApps[key]
    expect(stillOpen?.projectId).toBe('project-A-id')
  })

  it('openAppInPanel records null projectId when no project is active at open time', async () => {
    appStateRef.currentProjectId = null
    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj')

    const key = makeInstanceKey('panel-app', null)
    const open = useMiniAppStore.getState().openApps[key]
    expect(open?.projectId).toBeNull()
  })

  it('opening the same app from two different projects creates two independent instances', async () => {
    appStateRef.currentProjectId = 'A'
    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj-A')

    appStateRef.currentProjectId = 'B'
    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj-B')

    const keyA = makeInstanceKey('panel-app', 'A')
    const keyB = makeInstanceKey('panel-app', 'B')
    const state = useMiniAppStore.getState()
    expect(state.openApps[keyA]).toBeDefined()
    expect(state.openApps[keyB]).toBeDefined()
    expect(state.openApps[keyA]?.projectId).toBe('A')
    expect(state.openApps[keyB]?.projectId).toBe('B')
  })

  it('closing one project-instance fires MINIAPP_CLOSE for that project-dir only', async () => {
    appStateRef.currentProjectId = 'A'
    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj-A')
    appStateRef.currentProjectId = 'B'
    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj-B')
    mockMiniapp.close.mockClear()

    const keyA = makeInstanceKey('panel-app', 'A')
    const keyB = makeInstanceKey('panel-app', 'B')

    await useMiniAppStore.getState().closeApp(keyA)
    expect(mockMiniapp.close).toHaveBeenCalledTimes(1)
    expect(mockMiniapp.close).toHaveBeenCalledWith('panel-app', '/proj-A')
    expect(useMiniAppStore.getState().openApps[keyA]).toBeUndefined()
    expect(useMiniAppStore.getState().openApps[keyB]).toBeDefined()

    mockMiniapp.close.mockClear()
    await useMiniAppStore.getState().closeApp(keyB)
    expect(mockMiniapp.close).toHaveBeenCalledWith('panel-app', '/proj-B')
    expect(useMiniAppStore.getState().openApps[keyB]).toBeUndefined()
  })

  it('opening a second project-instance fires its own MINIAPP_OPEN (per-projectDir registration)', async () => {
    appStateRef.currentProjectId = 'A'
    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj-A')
    mockMiniapp.open.mockClear()

    appStateRef.currentProjectId = 'B'
    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj-B')

    expect(mockMiniapp.open).toHaveBeenCalledTimes(1)
    expect(mockMiniapp.open).toHaveBeenCalledWith('panel-app', '/proj-B')
  })

  it('opening an already-open instance focuses the tab without re-opening', async () => {
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
    const key = makeInstanceKey('fullscreen-app', 'proj-id-1')
    mockMiniapp.open.mockClear()
    mockMiniapp.close.mockClear()
    mockOpenMiniAppTab.mockClear()
    mockCloseMiniAppTab.mockClear()

    useMiniAppStore.getState().moveAppToCanvas(key)

    expect(mockMiniapp.open).not.toHaveBeenCalled()
    expect(mockMiniapp.close).not.toHaveBeenCalled()
    expect(mockCloseMiniAppTab).toHaveBeenCalledWith(key)
    expect(mockSetLayoutMode).toHaveBeenLastCalledWith('canvas')

    const open = useMiniAppStore.getState().openApps[key]
    expect(open?.presentation).toBe('canvas')
    expect(useMiniAppStore.getState().fullscreenApp?.instanceKey).toBe(key)
  })

  it('moveAppToPanel flips presentation without calling MINIAPP_OPEN or MINIAPP_CLOSE', async () => {
    const app = entry('fullscreen-app', true)
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')
    const key = makeInstanceKey('fullscreen-app', 'proj-id-1')
    useMiniAppStore.getState().moveAppToCanvas(key)
    mockMiniapp.open.mockClear()
    mockMiniapp.close.mockClear()
    mockOpenMiniAppTab.mockClear()
    mockSetLayoutMode.mockClear()

    useMiniAppStore.getState().moveAppToPanel(key)

    expect(mockMiniapp.open).not.toHaveBeenCalled()
    expect(mockMiniapp.close).not.toHaveBeenCalled()
    expect(mockOpenMiniAppTab).toHaveBeenCalledWith(key, 'fullscreen-app', 'App fullscreen-app')
    expect(mockSetLayoutMode).toHaveBeenCalledWith('coding')

    const open = useMiniAppStore.getState().openApps[key]
    expect(open?.presentation).toBe('panel')
    expect(useMiniAppStore.getState().fullscreenApp).toBeNull()
  })

  it('panel → canvas → panel preserves openApps and calls open/close zero extra times', async () => {
    const app = entry('fullscreen-app', true)
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')
    const key = makeInstanceKey('fullscreen-app', 'proj-id-1')
    expect(mockMiniapp.open).toHaveBeenCalledTimes(1)

    useMiniAppStore.getState().moveAppToCanvas(key)
    useMiniAppStore.getState().moveAppToPanel(key)

    expect(mockMiniapp.open).toHaveBeenCalledTimes(1)
    expect(mockMiniapp.close).not.toHaveBeenCalled()

    const open = useMiniAppStore.getState().openApps[key]
    expect(open?.presentation).toBe('panel')
  })

  it('closeApp removes the instance and triggers MINIAPP_CLOSE with its projectDir', async () => {
    const app = entry('panel-app')
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')
    const key = makeInstanceKey('panel-app', 'proj-id-1')
    mockMiniapp.close.mockClear()
    mockCloseMiniAppTab.mockClear()

    await useMiniAppStore.getState().closeApp(key)

    expect(mockMiniapp.close).toHaveBeenCalledWith('panel-app', '/proj')
    expect(mockCloseMiniAppTab).toHaveBeenCalledWith(key)
    expect(useMiniAppStore.getState().openApps[key]).toBeUndefined()
  })

  it('closing a tab while another session still references the same instance keeps openApps and skips MINIAPP_CLOSE (per-project iframe sharing)', async () => {
    const app = entry('panel-app')
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')
    const key = makeInstanceKey('panel-app', 'proj-id-1')
    mockMiniapp.close.mockClear()
    mockCloseMiniAppTab.mockClear()
    mockIsInstanceReferenced.mockReturnValue(true)

    await useMiniAppStore.getState().closeApp(key)

    expect(mockMiniapp.close).not.toHaveBeenCalled()
    expect(mockCloseMiniAppTab).toHaveBeenCalledWith(key)
    expect(useMiniAppStore.getState().openApps[key]).toBeDefined()
  })

  it('closing the last referencing session unloads the instance and fires MINIAPP_CLOSE', async () => {
    const app = entry('panel-app')
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')
    const key = makeInstanceKey('panel-app', 'proj-id-1')

    mockIsInstanceReferenced.mockReturnValueOnce(true)
    await useMiniAppStore.getState().closeApp(key)
    expect(useMiniAppStore.getState().openApps[key]).toBeDefined()

    mockIsInstanceReferenced.mockReturnValue(false)
    mockMiniapp.close.mockClear()
    await useMiniAppStore.getState().closeApp(key)

    expect(mockMiniapp.close).toHaveBeenCalledWith('panel-app', '/proj')
    expect(useMiniAppStore.getState().openApps[key]).toBeUndefined()
  })

  it('closing a canvas app switches layoutMode back to coding', async () => {
    const app = entry('fullscreen-app', true)
    await useMiniAppStore.getState().openFullscreenApp(app, '/proj')
    const key = makeInstanceKey('fullscreen-app', 'proj-id-1')
    mockSetLayoutMode.mockClear()

    await useMiniAppStore.getState().closeApp(key)

    expect(mockSetLayoutMode).toHaveBeenCalledWith('coding')
    expect(useMiniAppStore.getState().fullscreenApp).toBeNull()
  })

  it('uninstallApp closes every open instance of the appId before deleting', async () => {
    appStateRef.currentProjectId = 'A'
    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj-A')
    appStateRef.currentProjectId = 'B'
    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj-B')

    const callOrder: string[] = []
    mockMiniapp.close.mockImplementation(async () => { callOrder.push('close') })
    mockMiniapp.uninstall.mockImplementationOnce(async () => { callOrder.push('uninstall') })

    await useMiniAppStore.getState().uninstallApp('panel-app')

    expect(callOrder).toEqual(['close', 'close', 'uninstall'])
    expect(mockMiniapp.close).toHaveBeenCalledTimes(2)
    expect(mockMiniapp.close).toHaveBeenCalledWith('panel-app', '/proj-A')
    expect(mockMiniapp.close).toHaveBeenCalledWith('panel-app', '/proj-B')
    expect(useMiniAppStore.getState().openApps[makeInstanceKey('panel-app', 'A')]).toBeUndefined()
    expect(useMiniAppStore.getState().openApps[makeInstanceKey('panel-app', 'B')]).toBeUndefined()
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
    const key = makeInstanceKey('panel-app', 'proj-id-1')
    const rect = { left: 10, top: 20, width: 300, height: 400 } as DOMRectReadOnly
    useMiniAppStore.getState().updateSlot(key, 'panel', rect)

    const slot = useMiniAppStore.getState().slots[key]
    expect(slot).toEqual({ mode: 'panel', left: 10, top: 20, width: 300, height: 400 })

    useMiniAppStore.getState().unregisterSlot(key, 'panel')
    expect(useMiniAppStore.getState().slots[key]).toBeUndefined()
  })

  it('unregisterSlot ignores stale mode (mode-mismatched call does not clear current slot)', () => {
    const key = makeInstanceKey('a', 'proj-id-1')
    const rect = { left: 0, top: 0, width: 100, height: 100 } as DOMRectReadOnly
    useMiniAppStore.getState().updateSlot(key, 'canvas', rect)

    useMiniAppStore.getState().unregisterSlot(key, 'panel')

    expect(useMiniAppStore.getState().slots[key]?.mode).toBe('canvas')
  })
})
