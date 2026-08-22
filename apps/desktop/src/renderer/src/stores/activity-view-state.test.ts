/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SerializedDockview } from 'dockview-core'

const {
  mockApplyDockSnapshot,
  mockGetDockSnapshot,
  mockIsDockReady,
  mockSetOnDockReady,
  mockSetShowPanel,
  mockCloseGhostMiniAppPanels,
  mockMaterializeOwnedBrowserTabs,
  openAppsRef,
} = vi.hoisted(() => ({
  mockApplyDockSnapshot: vi.fn(),
  mockGetDockSnapshot: vi.fn<() => SerializedDockview | null>(),
  mockIsDockReady: vi.fn<() => boolean>(),
  mockSetOnDockReady: vi.fn<(cb: (() => void) | null) => void>(),
  mockSetShowPanel: vi.fn(),
  mockCloseGhostMiniAppPanels: vi.fn<(isAlive: (appId: string) => boolean) => void>(),
  mockMaterializeOwnedBrowserTabs: vi.fn<(sessionId: string) => void>(),
  openAppsRef: { value: {} as Record<string, unknown> },
}))

vi.mock('@/components/activity/activity-panel-api', () => ({
  applyDockSnapshot: mockApplyDockSnapshot,
  getDockSnapshot: mockGetDockSnapshot,
  isDockReady: mockIsDockReady,
  setOnDockReady: mockSetOnDockReady,
  setCurrentSessionIdGetter: vi.fn(),
  closeGhostMiniAppPanels: mockCloseGhostMiniAppPanels,
  materializeOwnedBrowserTabs: mockMaterializeOwnedBrowserTabs,
}))

vi.mock('./miniapp', () => ({
  useMiniAppStore: {
    getState: () => ({ openApps: openAppsRef.value }),
  },
}))

let mockShowPanel = false
vi.mock('./activity-panel', () => ({
  useActivityPanelStore: {
    getState: () => ({
      get showPanel() { return mockShowPanel },
      setShowPanel: (v: boolean) => {
        mockShowPanel = v
        mockSetShowPanel(v)
      },
    }),
  },
}))

let useActivityViewStateStore: typeof import('./activity-view-state').useActivityViewStateStore
let isInstanceReferencedInSavedSessions: typeof import('./activity-view-state').isInstanceReferencedInSavedSessions

function makeLayout(panelId: string): SerializedDockview {
  return {
    grid: { root: { type: 'leaf', data: { views: [panelId], activeView: panelId, id: 'g1' }, size: 1 }, height: 100, width: 100, orientation: 'HORIZONTAL' },
    panels: { [panelId]: { id: panelId, contentComponent: 'file-preview', tabComponent: 'file-preview-tab', params: { filePath: panelId } } },
    activeGroup: 'g1',
  } as unknown as SerializedDockview
}

beforeEach(async () => {
  vi.resetModules()
  mockApplyDockSnapshot.mockReset()
  mockGetDockSnapshot.mockReset()
  mockIsDockReady.mockReset()
  mockSetOnDockReady.mockReset()
  mockSetShowPanel.mockReset()
  mockCloseGhostMiniAppPanels.mockReset()
  mockMaterializeOwnedBrowserTabs.mockReset()
  mockShowPanel = false
  openAppsRef.value = {}
  ;({ useActivityViewStateStore, isInstanceReferencedInSavedSessions } = await import('./activity-view-state'))
  useActivityViewStateStore.getState()._resetForTest()
})

describe('activity-view-state', () => {
  it('park reads dock snapshot + showPanel and stores by sessionId', () => {
    mockIsDockReady.mockReturnValue(true)
    const layout = makeLayout('foo')
    mockGetDockSnapshot.mockReturnValue(layout)
    mockShowPanel = true

    useActivityViewStateStore.getState().park('sess-A')

    const stored = useActivityViewStateStore.getState().perSession['sess-A']
    expect(stored).toEqual({ layout, showPanel: true })
  })

  it('park stores an isolated copy that survives later mutation of the live layout', () => {
    mockIsDockReady.mockReturnValue(true)
    const liveLayout = makeLayout('foo')
    mockGetDockSnapshot.mockReturnValue(liveLayout)

    useActivityViewStateStore.getState().park('sess-A')
    ;(liveLayout as unknown as { activeGroup: string }).activeGroup = 'mutated-after-park'

    const stored = useActivityViewStateStore.getState().perSession['sess-A']
    expect((stored.layout as unknown as { activeGroup: string }).activeGroup).toBe('g1')
  })

  it('restore hands fromJSON an isolated copy that does not let dockview mutate perSession', () => {
    mockIsDockReady.mockReturnValue(true)
    mockGetDockSnapshot.mockReturnValue(makeLayout('foo'))
    useActivityViewStateStore.getState().park('sess-A')

    mockApplyDockSnapshot.mockClear()
    useActivityViewStateStore.getState().restore('sess-A')

    const handed = mockApplyDockSnapshot.mock.calls[0][0]
    ;(handed as unknown as { activeGroup: string }).activeGroup = 'mutated-by-fromJSON'

    const stored = useActivityViewStateStore.getState().perSession['sess-A']
    expect((stored.layout as unknown as { activeGroup: string }).activeGroup).toBe('g1')
  })

  it('park is a no-op when dock is not ready', () => {
    mockIsDockReady.mockReturnValue(false)
    useActivityViewStateStore.getState().park('sess-A')
    expect(useActivityViewStateStore.getState().perSession['sess-A']).toBeUndefined()
    expect(mockGetDockSnapshot).not.toHaveBeenCalled()
  })

  it('restore applies stored layout + showPanel for the same sessionId', () => {
    mockIsDockReady.mockReturnValue(true)
    const layout = makeLayout('foo')
    mockGetDockSnapshot.mockReturnValue(layout)
    mockShowPanel = true
    useActivityViewStateStore.getState().park('sess-A')

    mockApplyDockSnapshot.mockClear()
    mockSetShowPanel.mockClear()

    useActivityViewStateStore.getState().restore('sess-A')

    expect(mockApplyDockSnapshot).toHaveBeenCalledWith(layout)
    expect(mockSetShowPanel).toHaveBeenCalledWith(true)
  })

  it('restore for an unknown sessionId applies an empty layout (no implicit fork)', () => {
    mockIsDockReady.mockReturnValue(true)
    mockGetDockSnapshot.mockReturnValue(makeLayout('orig'))
    mockShowPanel = true
    useActivityViewStateStore.getState().park('sess-A')

    mockApplyDockSnapshot.mockClear()
    mockSetShowPanel.mockClear()

    useActivityViewStateStore.getState().restore('sess-history-B')

    expect(useActivityViewStateStore.getState().perSession['sess-history-B']).toBeUndefined()
    expect(mockApplyDockSnapshot).toHaveBeenCalledWith(null)
    expect(mockSetShowPanel).toHaveBeenCalledWith(false)
  })

  it('seedFromCurrent snapshots the live dockview as a new sessionId entry', () => {
    mockIsDockReady.mockReturnValue(true)
    const layout = makeLayout('current')
    mockGetDockSnapshot.mockReturnValue(layout)
    mockShowPanel = true

    useActivityViewStateStore.getState().seedFromCurrent('sess-new')

    const seed = useActivityViewStateStore.getState().perSession['sess-new']
    expect(seed).toEqual({ layout, showPanel: true })
    expect(seed.layout).not.toBe(layout)
  })

  it('seedFromCurrent + park give independent layouts that survive mutation', () => {
    mockIsDockReady.mockReturnValue(true)
    mockGetDockSnapshot.mockReturnValue(makeLayout('orig'))
    useActivityViewStateStore.getState().park('sess-A')

    useActivityViewStateStore.getState().seedFromCurrent('sess-B')

    const b = useActivityViewStateStore.getState().perSession['sess-B']
    ;(b.layout as unknown as { activeGroup: string }).activeGroup = 'mutated'

    const a = useActivityViewStateStore.getState().perSession['sess-A']
    expect((a.layout as unknown as { activeGroup: string }).activeGroup).toBe('g1')
  })

  it('seedFromCurrent is a no-op when dock is not ready', () => {
    mockIsDockReady.mockReturnValue(false)
    useActivityViewStateStore.getState().seedFromCurrent('sess-new')
    expect(useActivityViewStateStore.getState().perSession['sess-new']).toBeUndefined()
    expect(mockGetDockSnapshot).not.toHaveBeenCalled()
  })

  it('restore for a never-seen sessionId applies an empty layout', () => {
    mockIsDockReady.mockReturnValue(true)

    useActivityViewStateStore.getState().restore('first-sess')

    expect(mockApplyDockSnapshot).toHaveBeenCalledWith(null)
    expect(mockSetShowPanel).toHaveBeenCalledWith(false)
  })

  it('defers restore when dock is not ready and applies on flushPending', () => {
    mockIsDockReady.mockReturnValue(true)
    mockGetDockSnapshot.mockReturnValue(makeLayout('parked'))
    mockShowPanel = true
    useActivityViewStateStore.getState().park('sess-A')

    mockIsDockReady.mockReturnValue(false)
    mockApplyDockSnapshot.mockClear()
    mockSetShowPanel.mockClear()

    useActivityViewStateStore.getState().restore('sess-A')
    expect(useActivityViewStateStore.getState().pendingRestore).toBe('sess-A')
    expect(mockApplyDockSnapshot).not.toHaveBeenCalled()

    mockIsDockReady.mockReturnValue(true)
    useActivityViewStateStore.getState().flushPending()

    expect(useActivityViewStateStore.getState().pendingRestore).toBeNull()
    expect(mockApplyDockSnapshot).toHaveBeenCalledWith(makeLayout('parked'))
    expect(mockSetShowPanel).toHaveBeenCalledWith(true)
  })

  it('materializes owned browser tabs when a session is restored (regression: background browser_open landed in the on-screen session)', () => {
    mockIsDockReady.mockReturnValue(true)
    mockGetDockSnapshot.mockReturnValue(makeLayout('foo'))
    useActivityViewStateStore.getState().park('sess-A')

    mockMaterializeOwnedBrowserTabs.mockClear()
    useActivityViewStateStore.getState().restore('sess-A')

    expect(mockMaterializeOwnedBrowserTabs).toHaveBeenCalledWith('sess-A')
  })

  it('materializes owned browser tabs when a deferred restore flushes on dock-ready', () => {
    mockIsDockReady.mockReturnValue(true)
    mockGetDockSnapshot.mockReturnValue(makeLayout('parked'))
    useActivityViewStateStore.getState().park('sess-A')

    mockIsDockReady.mockReturnValue(false)
    useActivityViewStateStore.getState().restore('sess-A')
    expect(mockMaterializeOwnedBrowserTabs).not.toHaveBeenCalled()

    mockIsDockReady.mockReturnValue(true)
    useActivityViewStateStore.getState().flushPending()

    expect(mockMaterializeOwnedBrowserTabs).toHaveBeenCalledWith('sess-A')
  })

  it('clearForSession removes the entry and clears matching pendingRestore', () => {
    mockIsDockReady.mockReturnValue(true)
    mockGetDockSnapshot.mockReturnValue(makeLayout('foo'))
    useActivityViewStateStore.getState().park('sess-A')

    mockIsDockReady.mockReturnValue(false)
    useActivityViewStateStore.getState().restore('sess-A')
    expect(useActivityViewStateStore.getState().pendingRestore).toBe('sess-A')

    useActivityViewStateStore.getState().clearForSession('sess-A')

    expect(useActivityViewStateStore.getState().perSession['sess-A']).toBeUndefined()
    expect(useActivityViewStateStore.getState().pendingRestore).toBeNull()
  })

  it('registers a flushPending callback on dock-ready at module load', () => {
    expect(mockSetOnDockReady).toHaveBeenCalledTimes(1)
    const cb = mockSetOnDockReady.mock.calls[0][0]
    expect(cb).toBeInstanceOf(Function)
  })

  it('restore closes ghost miniapp panels whose instanceKey is no longer in openApps (regression: black-screen after cross-session close)', () => {
    mockIsDockReady.mockReturnValue(true)
    mockGetDockSnapshot.mockReturnValue(makeLayout('miniapp-X:proj-1'))
    openAppsRef.value = { 'X:proj-1': {} }
    useActivityViewStateStore.getState().park('sess-A')

    openAppsRef.value = {}
    mockCloseGhostMiniAppPanels.mockClear()

    useActivityViewStateStore.getState().restore('sess-A')

    expect(mockCloseGhostMiniAppPanels).toHaveBeenCalledTimes(1)
    const isAlive = mockCloseGhostMiniAppPanels.mock.calls[0][0]
    expect(isAlive('X:proj-1')).toBe(false)
  })

  it('restore keeps miniapp panels whose instanceKey is still alive in openApps', () => {
    mockIsDockReady.mockReturnValue(true)
    mockGetDockSnapshot.mockReturnValue(makeLayout('miniapp-Y:proj-1'))
    openAppsRef.value = { 'Y:proj-1': {} }
    useActivityViewStateStore.getState().park('sess-A')

    mockCloseGhostMiniAppPanels.mockClear()
    useActivityViewStateStore.getState().restore('sess-A')

    const isAlive = mockCloseGhostMiniAppPanels.mock.calls[0][0]
    expect(isAlive('Y:proj-1')).toBe(true)
  })

  it('isInstanceReferencedInSavedSessions returns true when any parked layout has a matching miniapp panel id', () => {
    mockIsDockReady.mockReturnValue(true)
    mockGetDockSnapshot.mockReturnValue(makeLayout('miniapp-X:proj-1'))
    useActivityViewStateStore.getState().park('sess-A')

    expect(isInstanceReferencedInSavedSessions('X:proj-1')).toBe(true)
    expect(isInstanceReferencedInSavedSessions('Y:proj-1')).toBe(false)
  })

  it('isInstanceReferencedInSavedSessions returns false when all sessions have been cleared', () => {
    mockIsDockReady.mockReturnValue(true)
    mockGetDockSnapshot.mockReturnValue(makeLayout('miniapp-X:proj-1'))
    useActivityViewStateStore.getState().park('sess-A')
    useActivityViewStateStore.getState().clearForSession('sess-A')

    expect(isInstanceReferencedInSavedSessions('X:proj-1')).toBe(false)
  })

  it('isInstanceReferencedInSavedSessions excludes the current session’s stale snapshot when closing a shared WebView', () => {
    mockIsDockReady.mockReturnValue(true)
    mockGetDockSnapshot.mockReturnValue(makeLayout('miniapp-X:proj-1'))
    // sess-A was parked once with the panel — but sess-A is now the active session and the user just closed the panel.
    useActivityViewStateStore.getState().park('sess-A')
    useActivityViewStateStore.getState().restore('sess-A')

    expect(useActivityViewStateStore.getState()._currentSessionId).toBe('sess-A')
    // Stale snapshot of sess-A still has the panel, but since sess-A is current, it must not count as a reference.
    expect(isInstanceReferencedInSavedSessions('X:proj-1')).toBe(false)
  })

  it('isInstanceReferencedInSavedSessions still flags another session’s parked layout even when current session has the same instance', () => {
    mockIsDockReady.mockReturnValue(true)
    mockGetDockSnapshot.mockReturnValue(makeLayout('miniapp-X:proj-1'))
    useActivityViewStateStore.getState().park('sess-A')
    useActivityViewStateStore.getState().park('sess-B')
    useActivityViewStateStore.getState().restore('sess-B')

    // Current is sess-B. sess-A still references the panel.
    expect(isInstanceReferencedInSavedSessions('X:proj-1')).toBe(true)
  })

  it('flushPending also runs ghost cleanup once dock becomes ready', () => {
    mockIsDockReady.mockReturnValue(true)
    mockGetDockSnapshot.mockReturnValue(makeLayout('miniapp-Z:proj-1'))
    openAppsRef.value = { 'Z:proj-1': {} }
    useActivityViewStateStore.getState().park('sess-A')

    mockIsDockReady.mockReturnValue(false)
    useActivityViewStateStore.getState().restore('sess-A')
    expect(mockCloseGhostMiniAppPanels).not.toHaveBeenCalled()

    openAppsRef.value = {}
    mockIsDockReady.mockReturnValue(true)
    useActivityViewStateStore.getState().flushPending()

    expect(mockCloseGhostMiniAppPanels).toHaveBeenCalledTimes(1)
    const isAlive = mockCloseGhostMiniAppPanels.mock.calls[0][0]
    expect(isAlive('Z:proj-1')).toBe(false)
  })
})
