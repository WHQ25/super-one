/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SerializedDockview } from 'dockview-core'

const {
  mockApplyDockSnapshot,
  mockGetDockSnapshot,
  mockIsDockReady,
  mockSetOnDockReady,
  mockSetShowPanel,
} = vi.hoisted(() => ({
  mockApplyDockSnapshot: vi.fn(),
  mockGetDockSnapshot: vi.fn<() => SerializedDockview | null>(),
  mockIsDockReady: vi.fn<() => boolean>(),
  mockSetOnDockReady: vi.fn<(cb: (() => void) | null) => void>(),
  mockSetShowPanel: vi.fn(),
}))

vi.mock('@/components/activity/activity-panel-api', () => ({
  applyDockSnapshot: mockApplyDockSnapshot,
  getDockSnapshot: mockGetDockSnapshot,
  isDockReady: mockIsDockReady,
  setOnDockReady: mockSetOnDockReady,
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
  mockShowPanel = false
  ;({ useActivityViewStateStore } = await import('./activity-view-state'))
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
})
