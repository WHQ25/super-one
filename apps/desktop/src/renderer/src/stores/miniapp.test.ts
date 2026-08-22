/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'
import { LAYOUT } from '@/lib/layout-constants'

type MockChatState = {
  projectSessions: Record<string, { _activeSessionId: string | null; _sessions: Record<string, unknown> }>
}

const { mockOpenMiniAppTab, mockCloseMiniAppTab, mockSetPanelWidth, mockIsInstanceReferenced, appStateRef, mockChatState, chatSubs } = vi.hoisted(() => ({
  mockOpenMiniAppTab: vi.fn(),
  mockCloseMiniAppTab: vi.fn(),
  mockSetPanelWidth: vi.fn(),
  mockIsInstanceReferenced: vi.fn<(instanceKey: string) => boolean>(),
  appStateRef: { showSidebar: true, sidebarWidth: 320, currentProjectId: 'proj-id-1' as string | null } as { showSidebar: boolean; sidebarWidth: number; currentProjectId: string | null },
  mockChatState: { projectSessions: {} } as { projectSessions: Record<string, { _activeSessionId: string | null; _sessions: Record<string, unknown> }> },
  chatSubs: [] as Array<(state: { projectSessions: Record<string, { _activeSessionId: string | null; _sessions: Record<string, unknown> }> }) => void>,
}))

vi.mock('./activity-view-state', () => ({
  isInstanceReferencedInSavedSessions: mockIsInstanceReferenced,
}))

vi.mock('./chat', () => ({
  useChatStore: {
    getState: () => ({
      projectSessions: mockChatState.projectSessions,
      ensureSession: (projectPath: string) => {
        const proj = mockChatState.projectSessions[projectPath]
        if (!proj) {
          mockChatState.projectSessions[projectPath] = { _activeSessionId: `auto-${projectPath}`, _sessions: {} }
        } else if (!proj._activeSessionId) {
          proj._activeSessionId = `auto-${projectPath}`
        }
      },
    }),
    setState: () => {},
    subscribe: (cb: (state: MockChatState) => void) => {
      chatSubs.push(cb)
      return () => {
        const i = chatSubs.indexOf(cb)
        if (i >= 0) chatSubs.splice(i, 1)
      }
    },
  },
}))

function triggerSessionSwitch(projectPath: string, newSid: string | null) {
  let proj = mockChatState.projectSessions[projectPath]
  if (!proj) {
    proj = { _activeSessionId: null, _sessions: {} }
    mockChatState.projectSessions[projectPath] = proj
  }
  proj._activeSessionId = newSid
  const snapshot = { projectSessions: { ...mockChatState.projectSessions } }
  for (const cb of [...chatSubs]) cb(snapshot)
}

async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

vi.mock('./app', () => ({
  useAppStore: {
    getState: () => ({
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

function entry(id: string, preferWidth?: number): MiniAppEntry {
  return {
    id,
    installDir: `/install/${id}`,
    manifest: {
      appId: id,
      name: `App ${id}`,
      main: 'node.js',
      ...(preferWidth != null && { preferWidth }),
    },
  }
}

const APPS: MiniAppEntry[] = [
  entry('panel-app'),
  entry('second-app'),
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
  mockChatState.projectSessions = {}
  chatSubs.length = 0

  vi.resetModules()
  ;({ useMiniAppStore, makeInstanceKey } = await import('./miniapp'))

  await useMiniAppStore.getState().refreshApps('/proj')
  await flushMicrotasks()
})

describe('miniapp store onDevAppReady routing', () => {
  it('registers a handler at module load time', () => {
    expect(mockMiniapp.onDevAppReady).toHaveBeenCalledTimes(1)
    expect(typeof capturedHandler).toBe('function')
  })

  it('opens only the signaled panel app, not other dev apps in the list', async () => {
    await capturedHandler!('/proj', 'panel-app')

    expect(mockMiniapp.open).toHaveBeenCalledTimes(1)
    expect(mockMiniapp.open).toHaveBeenCalledWith('panel-app', '/proj', expect.any(String))
    expect(mockOpenMiniAppTab).toHaveBeenCalledTimes(1)
    expect(mockOpenMiniAppTab).toHaveBeenCalledWith(makeInstanceKey('panel-app', 'proj-id-1'), 'panel-app', 'App panel-app')
  })

  it('opens any signaled app in the activity panel', async () => {
    await capturedHandler!('/proj', 'second-app')

    expect(mockMiniapp.open).toHaveBeenCalledWith('second-app', '/proj', expect.any(String))
    expect(mockOpenMiniAppTab).toHaveBeenCalledWith(makeInstanceKey('second-app', 'proj-id-1'), 'second-app', 'App second-app')
  })

  it('does nothing when the signaled appId is not in the refreshed list', async () => {
    await capturedHandler!('/proj', 'never-existed')

    expect(mockMiniapp.open).not.toHaveBeenCalled()
    expect(mockOpenMiniAppTab).not.toHaveBeenCalled()
  })

  it('refreshes apps before routing so a freshly-scaffolded appId is found', async () => {
    const fresh = entry('fresh-app')
    mockMiniapp.list.mockResolvedValueOnce([...APPS, fresh])

    await capturedHandler!('/proj', 'fresh-app')

    expect(mockMiniapp.list).toHaveBeenLastCalledWith('/proj')
    expect(mockMiniapp.open).toHaveBeenCalledWith('fresh-app', '/proj', expect.any(String))
    expect(mockOpenMiniAppTab).toHaveBeenCalledWith(makeInstanceKey('fresh-app', 'proj-id-1'), 'fresh-app', 'App fresh-app')
  })

  it('signaling one app among many opens exactly one (regression: old code opened all dev apps)', async () => {
    await capturedHandler!('/proj', 'second-app')

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

  it('routes a minimal manifest to the panel', async () => {
    const noFlag: MiniAppEntry = {
      id: 'no-flag-app',
      installDir: '/install/no-flag-app',
      manifest: { appId: 'no-flag-app', name: 'No Flag', main: 'node.js' },
    }
    mockMiniapp.list.mockResolvedValueOnce([noFlag])

    await capturedHandler!('/proj', 'no-flag-app')

    expect(mockMiniapp.open).toHaveBeenCalledWith('no-flag-app', '/proj', expect.any(String))
  })
})

describe('miniapp store lifecycle (persistent WebView)', () => {
  it('openAppInPanel registers app instance keyed by (appId, projectId) and triggers MINIAPP_OPEN exactly once', async () => {
    const app = entry('second-app')
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')

    const key = makeInstanceKey('second-app', 'proj-id-1')
    expect(mockMiniapp.open).toHaveBeenCalledTimes(1)
    expect(mockMiniapp.open).toHaveBeenCalledWith('second-app', '/proj', expect.any(String))
    expect(mockOpenMiniAppTab).toHaveBeenCalledWith(key, 'second-app', 'App second-app')

    const open = useMiniAppStore.getState().openApps[key]
    expect(open).toBeDefined()
    expect(open?.projectDir).toBe('/proj')
    expect(open?.projectId).toBe('proj-id-1')
    expect(open?.instanceKey).toBe(key)
  })

  it('openAppInPanel captures the currentProjectId at open time so WebView origin stays stable across project switches', async () => {
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
    expect(mockMiniapp.close).toHaveBeenCalledWith('panel-app', '/proj-A', expect.any(String))
    expect(useMiniAppStore.getState().openApps[keyA]).toBeUndefined()
    expect(useMiniAppStore.getState().openApps[keyB]).toBeDefined()

    mockMiniapp.close.mockClear()
    await useMiniAppStore.getState().closeApp(keyB)
    expect(mockMiniapp.close).toHaveBeenCalledWith('panel-app', '/proj-B', expect.any(String))
    expect(useMiniAppStore.getState().openApps[keyB]).toBeUndefined()
  })

  it('opening a second project-instance fires its own MINIAPP_OPEN (per-projectDir registration)', async () => {
    appStateRef.currentProjectId = 'A'
    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj-A')
    mockMiniapp.open.mockClear()

    appStateRef.currentProjectId = 'B'
    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj-B')

    expect(mockMiniapp.open).toHaveBeenCalledTimes(1)
    expect(mockMiniapp.open).toHaveBeenCalledWith('panel-app', '/proj-B', expect.any(String))
  })

  it('opening an already-open instance focuses the tab and re-fires MINIAPP_OPEN (session-scoped registration)', async () => {
    const app = entry('second-app')
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')
    mockMiniapp.open.mockClear()
    mockOpenMiniAppTab.mockClear()

    await useMiniAppStore.getState().openAppInPanel(app, '/proj')

    expect(mockMiniapp.open).toHaveBeenCalledTimes(1)
    expect(mockOpenMiniAppTab).toHaveBeenCalledTimes(1)
  })

  it('closeApp removes the instance and triggers MINIAPP_CLOSE with its projectDir', async () => {
    const app = entry('panel-app')
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')
    const key = makeInstanceKey('panel-app', 'proj-id-1')
    mockMiniapp.close.mockClear()
    mockCloseMiniAppTab.mockClear()

    await useMiniAppStore.getState().closeApp(key)

    expect(mockMiniapp.close).toHaveBeenCalledWith('panel-app', '/proj', expect.any(String))
    expect(mockCloseMiniAppTab).toHaveBeenCalledWith(key)
    expect(useMiniAppStore.getState().openApps[key]).toBeUndefined()
  })

  it('closing in one session while another still holds the instance closes only that session and keeps the shared WebView alive', async () => {
    mockChatState.projectSessions['/proj'] = { _activeSessionId: 'sess-a', _sessions: {} }
    vi.resetModules()
    chatSubs.length = 0
    ;({ useMiniAppStore, makeInstanceKey } = await import('./miniapp'))
    await useMiniAppStore.getState().refreshApps('/proj')

    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj')
    mockChatState.projectSessions['/proj']._activeSessionId = 'sess-b'
    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj')

    const key = makeInstanceKey('panel-app', 'proj-id-1')
    expect(useMiniAppStore.getState().openApps[key]?.holderSessions.size).toBe(2)

    mockMiniapp.close.mockClear()
    mockCloseMiniAppTab.mockClear()
    await useMiniAppStore.getState().closeApp(key)

    expect(mockMiniapp.close).toHaveBeenCalledWith('panel-app', '/proj', 'sess-b')
    expect(mockMiniapp.close).toHaveBeenCalledTimes(1)
    expect(mockCloseMiniAppTab).toHaveBeenCalledWith(key)
    expect(useMiniAppStore.getState().openApps[key]).toBeDefined()
    expect(useMiniAppStore.getState().openApps[key]?.holderSessions.has('sess-a')).toBe(true)
    expect(useMiniAppStore.getState().openApps[key]?.holderSessions.has('sess-b')).toBe(false)
  })

  it('closing the last holder session unloads the instance and fires MINIAPP_CLOSE', async () => {
    mockChatState.projectSessions['/proj'] = { _activeSessionId: 'sess-a', _sessions: {} }
    vi.resetModules()
    chatSubs.length = 0
    ;({ useMiniAppStore, makeInstanceKey } = await import('./miniapp'))
    await useMiniAppStore.getState().refreshApps('/proj')

    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj')
    mockChatState.projectSessions['/proj']._activeSessionId = 'sess-b'
    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj')
    const key = makeInstanceKey('panel-app', 'proj-id-1')

    await useMiniAppStore.getState().closeApp(key)
    expect(useMiniAppStore.getState().openApps[key]).toBeDefined()

    mockChatState.projectSessions['/proj']._activeSessionId = 'sess-a'
    mockMiniapp.close.mockClear()
    await useMiniAppStore.getState().closeApp(key)

    expect(mockMiniapp.close).toHaveBeenCalledWith('panel-app', '/proj', 'sess-a')
    expect(useMiniAppStore.getState().openApps[key]).toBeUndefined()
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
    expect(mockMiniapp.close).toHaveBeenCalledWith('panel-app', '/proj-A', expect.any(String))
    expect(mockMiniapp.close).toHaveBeenCalledWith('panel-app', '/proj-B', expect.any(String))
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
    const app = entry('panel-app', 480)
    await useMiniAppStore.getState().openAppInPanel(app, '/proj')

    expect(mockSetPanelWidth).toHaveBeenCalledTimes(1)
    expect(mockSetPanelWidth).toHaveBeenCalledWith(480)
  })

  it('clamps preferWidth to available space when room is tight', async () => {
    // Derived, not hand-computed: the numbers move whenever a LAYOUT floor does.
    const sidebarWidth = 320
    const available = LAYOUT.MIN_AP + 68
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: sidebarWidth + LAYOUT.MIN_MAIN + LAYOUT.CARD_GUTTER + available,
    })
    appStateRef.sidebarWidth = sidebarWidth
    const app = entry('panel-app', available + 400)

    await useMiniAppStore.getState().openAppInPanel(app, '/proj')

    expect(mockSetPanelWidth).toHaveBeenCalledTimes(1)
    expect(mockSetPanelWidth).toHaveBeenCalledWith(available)
  })

  it('skips applying when there is no room (max < MIN_AP)', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 })
    appStateRef.sidebarWidth = 320
    const app = entry('panel-app', 480)

    await useMiniAppStore.getState().openAppInPanel(app, '/proj')

    expect(mockSetPanelWidth).not.toHaveBeenCalled()
  })

  it('does not apply preferWidth when re-opening an already-open app (focus only)', async () => {
    const app = entry('panel-app', 480)
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
    const app = entry('panel-app', 800)

    await useMiniAppStore.getState().openAppInPanel(app, '/proj')

    expect(mockSetPanelWidth).toHaveBeenCalledWith(588)
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

})

describe('regression: closing a mini-app must unregister its tools across active-session changes', () => {
  async function reloadStoreWithActiveSession(projectPath: string, sid: string) {
    mockChatState.projectSessions[projectPath] = { _activeSessionId: sid, _sessions: {} }
    chatSubs.length = 0
    vi.resetModules()
    ;({ useMiniAppStore, makeInstanceKey } = await import('./miniapp'))
    await useMiniAppStore.getState().refreshApps(projectPath)
    await flushMicrotasks()
  }

  it('close fires MINIAPP_CLOSE with the same sessionId that received MINIAPP_OPEN', async () => {
    await reloadStoreWithActiveSession('/proj', 'sess-a')

    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj')
    expect(mockMiniapp.open).toHaveBeenLastCalledWith('panel-app', '/proj', 'sess-a')

    const key = makeInstanceKey('panel-app', 'proj-id-1')
    mockMiniapp.close.mockClear()

    await useMiniAppStore.getState().closeApp(key)

    expect(mockMiniapp.close).toHaveBeenCalledWith('panel-app', '/proj', 'sess-a')
  })

  it('switching active session does NOT touch open/close (holding is per-session, not driven by active-sid changes)', async () => {
    await reloadStoreWithActiveSession('/proj', 'sess-a')
    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj')
    expect(mockMiniapp.open).toHaveBeenLastCalledWith('panel-app', '/proj', 'sess-a')

    mockMiniapp.open.mockClear()
    mockMiniapp.close.mockClear()

    triggerSessionSwitch('/proj', 'sess-b')
    await flushMicrotasks()

    expect(mockMiniapp.open).not.toHaveBeenCalled()
    expect(mockMiniapp.close).not.toHaveBeenCalled()

    const key = makeInstanceKey('panel-app', 'proj-id-1')
    expect(useMiniAppStore.getState().openApps[key]?.holderSessions.has('sess-a')).toBe(true)
    expect(useMiniAppStore.getState().openApps[key]?.holderSessions.has('sess-b')).toBe(false)
  })

  it('BUG: closing while another session still references the panel in its saved layout, then switching back, must NOT re-attach the tools', async () => {
    await reloadStoreWithActiveSession('/proj', 'sess-a')
    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj')

    triggerSessionSwitch('/proj', 'sess-b')
    await flushMicrotasks()

    mockIsInstanceReferenced.mockReturnValue(true)

    const key = makeInstanceKey('panel-app', 'proj-id-1')
    await useMiniAppStore.getState().closeApp(key)

    expect(mockMiniapp.close).toHaveBeenLastCalledWith('panel-app', '/proj', 'sess-b')
    expect(useMiniAppStore.getState().openApps[key]).toBeDefined()

    mockMiniapp.open.mockClear()
    mockMiniapp.close.mockClear()

    triggerSessionSwitch('/proj', 'sess-a')
    await flushMicrotasks()

    expect(mockMiniapp.open).not.toHaveBeenCalled()
  })

  it('BUG: opening in sessionA, closing in sessionA (panel survives via saved layout), then switching to sessionB must NOT silently re-register the tools on sessionB', async () => {
    await reloadStoreWithActiveSession('/proj', 'sess-a')
    await useMiniAppStore.getState().openAppInPanel(entry('panel-app'), '/proj')

    mockIsInstanceReferenced.mockReturnValue(true)

    const key = makeInstanceKey('panel-app', 'proj-id-1')
    await useMiniAppStore.getState().closeApp(key)

    expect(mockMiniapp.close).toHaveBeenLastCalledWith('panel-app', '/proj', 'sess-a')

    mockMiniapp.open.mockClear()
    mockMiniapp.close.mockClear()

    triggerSessionSwitch('/proj', 'sess-b')
    await flushMicrotasks()

    expect(mockMiniapp.open).not.toHaveBeenCalled()
  })
})
