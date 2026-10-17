/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { useChatStore, createDefaultPerSessionState, createDefaultProjectState } from '@/stores/chat'
import { mosaicTileId, useMosaicStore } from '@/components/mosaic/mosaic-store'
import { collectLeaves, makeLeaf, type MosaicBranch } from '@/components/mosaic/mosaic-tree'
import { layoutActForTarget, layoutSnapshotForTarget } from './layout-session'
import { registerMosaicDom } from '@/components/mosaic/mosaic-dom'
import { useWindowMiniModeStore } from '@/stores/window-mini-mode'

const caller = { sessionId: 'A', environmentId: 'desktop', opener: { kind: 'agent' as const } }
const local = (sessionId: string) => ({ environmentId: 'desktop', sessionId })
const tile = (sessionId: string) => makeLeaf(mosaicTileId('/p', sessionId), '/p', sessionId)
let area: DOMRect

beforeEach(() => {
  vi.restoreAllMocks()
  area = { x: 320, y: 5, width: 1200, height: 900 } as DOMRect
  Object.assign(window, { innerWidth: 2400, innerHeight: 1400 })
  document.body.innerHTML = '<div data-main-content></div>'
  vi.spyOn(document.querySelector('[data-main-content]')!, 'getBoundingClientRect').mockImplementation(() => area)
  useAppStore.setState({ view: 'main', experimentalRemoteNodesEnabled: true })
  useWindowMiniModeStore.setState({ phase: 'app' })
  const project = createDefaultProjectState()
  project._activeSessionId = 'A'
  project._sessions = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(id => [id, { ...createDefaultPerSessionState(), _historyHydrated: true }]))
  useChatStore.setState({ activeProject: '/p', projectSessions: { '/p': project }, mountedSessions: {},
    mountSession: vi.fn(async () => {}), unmountSession: vi.fn(),
    switchToSession: vi.fn(async (projectPath, sessionId) => {
      useChatStore.setState(s => ({ activeProject: projectPath, projectSessions: { ...s.projectSessions,
        [projectPath]: { ...(s.projectSessions[projectPath] ?? project), _activeSessionId: sessionId } } }))
    }),
  })
  useMosaicStore.setState({ mode: 'mosaic', root: { type: 'branch', direction: 'row', ratio: 0.4, first: tile('A'), second: tile('B') }, focusedTileId: tile('A').id, lastLayout: null })
  Object.assign(window, { environment: {
    sessionSource: vi.fn(async (path: string) => path.startsWith('remote:') ? 'node' : 'desktop'),
    sessionLinkTarget: vi.fn(async (ref) => ({ ref, projectPath: ref.environmentId === 'node' ? 'remote:route:/p' : '/p', connectionId: ref.environmentId === 'node' ? 'route' : null })),
    getSession: vi.fn(async (_connection, sid) => sid === 'missing' ? null : { cwd: '/p' }),
  } })
})

const act = (request: Record<string, unknown>, signal?: AbortSignal) => layoutActForTarget(caller, request as never, signal)
const ids = () => collectLeaves(useMosaicStore.getState().root).map(l => l.sessionId)

describe('session layout scenarios', () => {
  const customLayout = {
    direction: 'row', ratio: 1 / 3, first: 0,
    second: { direction: 'row', first: { direction: 'column', first: 1, second: 2 }, second: { direction: 'column', first: 3, second: 4 } },
  }

  it('rearranges five existing sessions into a full-height left tile and two stacked right columns', async () => {
    await act({ action: 'split_session', sessionIds: ['A', 'B', 'C', 'D', 'E'] })
    const result = await act({ action: 'split_session', sessionIds: ['A', 'B', 'C', 'D', 'E'], layout: customLayout })
    const [a, b, c, d, e] = result.layout!.tiles
    expect(a.height).toBe(900)
    expect(a.x).toBe(0)
    expect(b.x).toBe(c.x)
    expect(d.x).toBe(e.x)
    expect(b.y).toBe(d.y)
    expect(c.y).toBe(e.y)
    expect(b.height).toBeCloseTo(c.height)
    expect(b.width).toBeCloseTo(d.width)
    expect(result.layout?.focusedSession).toEqual(local('A'))
    expect(useChatStore.getState().switchToSession).not.toHaveBeenCalled()
    const root = useMosaicStore.getState().root
    await act({ action: 'maximize_split' })
    await act({ action: 'restore_splits' })
    expect(useMosaicStore.getState().root).toEqual(root)
    const divider = result.layout!.dividers[0]
    await act({ action: 'resize_splits', dividers: [{ id: divider.id, ratio: 0.35 }] })
    expect(ids()).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('rejects invalid explicit trees and layouts that do not fit without changing any tile', async () => {
    const before = useMosaicStore.getState()
    for (const layout of [
      0, { direction: 'row', first: 0, second: 0 },
      { direction: 'row', first: 0, second: 2 },
      { direction: 'row', first: 0.5, second: 1 },
      { direction: 'diagonal', first: 0, second: 1 },
      { direction: 'row', first: 0 },
      { direction: 'row', first: 0, second: 1, ratio: Infinity },
      { direction: 'row', first: 0, second: 1, ratio: 0.99 },
      { direction: 'row', first: 0, second: 1, extra: true },
    ]) await expect(act({ action: 'split_session', sessionIds: ['A', 'B'], layout })).rejects.toThrow()
    await expect(act({ action: 'split_session', sessionId: 'B', layout: customLayout })).rejects.toThrow()
    await expect(act({ action: 'resize_splits', layout: customLayout })).rejects.toThrow()
    // The area fits five automatically, but cannot fit five full-height columns.
    const tooWide = { direction: 'row', first: 0, second: { direction: 'row', first: 1, second: { direction: 'row', first: 2, second: { direction: 'row', first: 3, second: 4 } } } }
    await expect(act({ action: 'split_session', sessionIds: ['A', 'B', 'C', 'D', 'E'], layout: tooWide })).rejects.toThrow(/minimum/)
    expect(useMosaicStore.getState()).toMatchObject({ root: before.root, focusedTileId: before.focusedTileId, lastLayout: before.lastLayout })
    expect(useChatStore.getState().switchToSession).not.toHaveBeenCalled()
  })

  it('validates explicit proportions again after focus activation before publishing the tree', async () => {
    const before = useMosaicStore.getState().root
    const switchSession = useChatStore.getState().switchToSession
    useChatStore.setState({ switchToSession: vi.fn(async (path, sid) => {
      await switchSession(path, sid)
      area = { ...area, width: 900 }
    }) })
    await expect(act({ action: 'split_session', sessionIds: ['B', 'C'], layout: { direction: 'row', ratio: 0.65, first: 0, second: 1 } })).rejects.toThrow(/minimum/)
    expect(useMosaicStore.getState().root).toBe(before)
    expect(useChatStore.getState().projectSessions['/p']._activeSessionId).toBe('A')
  })

  it('focuses an existing tile and replaces an absent session without collapsing or resizing', async () => {
    const root = useMosaicStore.getState().root
    await act({ action: 'focus_session', target: local('B') })
    expect(useMosaicStore.getState()).toMatchObject({ mode: 'mosaic', root, focusedTileId: tile('B').id })
    await act({ action: 'focus_session', target: local('C') })
    expect(ids()).toEqual(['A', 'C'])
    expect((useMosaicStore.getState().root as MosaicBranch).ratio).toBe(0.4)
  })

  it('arranges only the complete batch, preserves focus, and returns the snapshot geometry', async () => {
    const result = await act({ action: 'split_session', sessionIds: ['C', 'A', 'D', 'E'] })
    expect(ids()).toEqual(['C', 'A', 'D', 'E'])
    expect(result.layout).toMatchObject({ mode: 'mosaic', maxSessions: 6, focusedSession: local('A'), area: { x: 320, y: 5, width: 1200, height: 900 } })
    expect(result.layout?.tiles).toHaveLength(4)
    const widths = result.layout!.tiles.map(t => t.width)
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(0.01)
    expect((await layoutSnapshotForTarget(caller)).layout).toEqual(result.layout)
  })

  it('uses the first listed session if focus is omitted and never adds the current session implicitly', async () => {
    await act({ action: 'split_session', sessionIds: ['D', 'C'] })
    expect(ids()).toEqual(['D', 'C'])
    expect(useChatStore.getState().projectSessions['/p']._activeSessionId).toBe('D')
  })

  it('preserves the complete old tree when activating a batch fallback fails', async () => {
    const before = useMosaicStore.getState()
    useChatStore.setState({ switchToSession: vi.fn(async () => { throw new Error('Session activation refused') }) })
    await expect(act({ action: 'split_session', sessionIds: ['C', 'D'] })).rejects.toThrow(/activation refused/)
    expect(useMosaicStore.getState()).toMatchObject({ root: before.root, focusedTileId: before.focusedTileId, mode: before.mode, lastLayout: before.lastLayout })
    expect(useChatStore.getState().mountSession).not.toHaveBeenCalled()
  })

  it('revalidates space after fallback activation and preserves newer user navigation before committing', async () => {
    const root = useMosaicStore.getState().root
    const switchSession = useChatStore.getState().switchToSession
    useChatStore.setState({ switchToSession: vi.fn(async (path, sid) => {
      await switchSession(path, sid)
      area = { ...area, width: 400 }
    }) })
    await expect(act({ action: 'split_session', sessionIds: ['C', 'D', 'E'] })).rejects.toThrow(/capacity.*2/i)
    expect(useMosaicStore.getState().root).toBe(root)
    expect(useChatStore.getState().projectSessions['/p']._activeSessionId).toBe('A')
    expect(useChatStore.getState().mountSession).not.toHaveBeenCalled()
    area = { ...area, width: 1200 }
    useChatStore.setState({ switchToSession: vi.fn(async (path, sid) => {
      await switchSession(path, sid)
      await switchSession(path, 'B') // a newer user selection after activation
    }) })
    expect(await act({ action: 'split_session', sessionIds: ['C', 'D'] })).toMatchObject({ reason: 'superseded' })
    expect(useMosaicStore.getState().root).toBe(root)
    expect(useChatStore.getState().projectSessions['/p']._activeSessionId).toBe('B')
  })

  it('validates all sessions, conflicts and current capacity before changing the layout', async () => {
    const root = useMosaicStore.getState().root
    for (const args of [
      { sessionIds: ['A', 'missing'] }, { sessionIds: ['A', 'B'], sessionId: 'C' },
      { sessionIds: ['A', 'B'], direction: 'right' }, { sessionIds: ['A', 'A'] },
      { sessionIds: ['A', local('A')] },
    ]) await expect(act({ action: 'split_session', ...args })).rejects.toThrow()
    await expect(act({ action: 'split_session', sessionIds: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] })).rejects.toThrow(/capacity.*6/i)
    expect(useMosaicStore.getState().root).toBe(root)
    expect(useChatStore.getState().switchToSession).not.toHaveBeenCalled()
  })

  it('rechecks geometry after asynchronous session preparation and abandons cancelled or newer navigation', async () => {
    const root = useMosaicStore.getState().root
    window.environment.getSession = vi.fn(async () => { area = { ...area, width: 400 }; return {} as never })
    await expect(act({ action: 'split_session', sessionIds: ['A', 'B', 'C'] })).rejects.toThrow(/capacity.*2/i)
    expect(useMosaicStore.getState().root).toBe(root)
    const abort = new AbortController()
    window.environment.getSession = vi.fn(async () => { abort.abort(); return {} as never })
    expect(await act({ action: 'split_session', sessionIds: ['A', 'B'] }, abort.signal)).toMatchObject({ reason: 'superseded' })
    window.environment.getSession = vi.fn(async () => { useMosaicStore.setState({ focusedTileId: tile('B').id }); return {} as never })
    expect(await act({ action: 'split_session', sessionIds: ['A', 'B'] })).toMatchObject({ reason: 'superseded' })
  })

  it('qualifies batch identities independently across environments and validates a failed remote batch atomically', async () => {
    const result = await act({ action: 'split_session', sessionIds: ['A', { environmentId: 'node', sessionId: 'A' }], layout: { direction: 'row', first: 1, second: 0 } })
    expect(result.layout?.tiles.map(t => t.session)).toEqual([{ environmentId: 'node', sessionId: 'A' }, local('A')])
    expect(result.layout?.focusedSession).toEqual(local('A'))
    const root = useMosaicStore.getState().root
    useAppStore.setState({ experimentalRemoteNodesEnabled: false })
    await expect(act({ action: 'split_session', sessionIds: ['A', { environmentId: 'node', sessionId: 'B' }], layout: { direction: 'row', first: 0, second: 1 } })).rejects.toThrow(/disabled/)
    expect(useMosaicStore.getState().root).toBe(root)
  })

  it('maximizes and restores proportions, exposing saved identities without hidden geometry', async () => {
    const root = useMosaicStore.getState().root
    const result = await act({ action: 'maximize_split', target: local('B') })
    expect(result.layout?.mode).toBe('maximized')
    expect(result.layout?.tiles).toHaveLength(1)
    expect(result.layout?.saved?.tiles).toHaveLength(2)
    expect(result.layout?.saved?.tiles[0]).not.toHaveProperty('width')
    await act({ action: 'restore_splits', target: 'foreground' })
    expect(useMosaicStore.getState()).toMatchObject({ mode: 'mosaic', root, focusedTileId: tile('B').id, lastLayout: null })
    await act({ action: 'maximize_split', target: local('B') })
    area = { ...area, width: 600 }
    await expect(act({ action: 'restore_splits', target: 'foreground' })).rejects.toThrow(/space|fit/i)
    expect(useMosaicStore.getState().mode).toBe('single')
  })

  it('closes saved tiles together and clears restore state at one remaining tile or closeAll', async () => {
    await act({ action: 'split_session', sessionIds: ['A', 'B', 'C', 'D'] })
    await act({ action: 'maximize_split', target: local('A') })
    await act({ action: 'close_split', sessionIds: ['B', 'C'] })
    expect(collectLeaves(useMosaicStore.getState().lastLayout!.root).map(l => l.sessionId)).toEqual(['A', 'D'])
    await act({ action: 'close_split', sessionIds: ['A', 'D'] })
    expect(useMosaicStore.getState()).toMatchObject({ mode: 'single', lastLayout: null })
    expect(useChatStore.getState().projectSessions['/p']._activeSessionId).toBe('A')
    await act({ action: 'split_session', sessionIds: ['A', 'B'] })
    await expect(act({ action: 'close_split', closeAll: true, sessionIds: ['B'] })).rejects.toThrow()
    await act({ action: 'close_split', closeAll: true })
    expect(useMosaicStore.getState()).toMatchObject({ mode: 'single', lastLayout: null })
  })

  it('validates parent and child divider ratios against the final tree and applies both or neither', async () => {
    area = { ...area, width: 1800 }
    await act({ action: 'split_session', sessionIds: ['A', 'B', 'C'] })
    const snap = (await layoutSnapshotForTarget(caller)).layout!
    const [parent, child] = snap.dividers
    const result = await act({ action: 'resize_splits', dividers: [{ id: parent.id, ratio: 0.45 }, { id: child.id, ratio: 0.5 }] })
    expect(result.layout?.dividers.map(d => d.ratio)).toEqual([0.45, 0.5])
    const root = useMosaicStore.getState().root
    for (const dividers of [[{ id: parent.id, ratio: 0.9 }], [{ id: child.id, ratio: NaN }], [{ id: 'stale', ratio: 0.5 }], [{ id: parent.id, ratio: 0.4 }, { id: parent.id, ratio: 0.6 }]]) {
      await expect(act({ action: 'resize_splits', dividers })).rejects.toThrow()
      expect(useMosaicStore.getState().root).toBe(root)
    }
  })

  it('fits exactly at the minimum-width/height boundary and rejects a one-pixel short area', async () => {
    area = { ...area, width: 721, height: 841 }
    const result = await act({ action: 'split_session', sessionIds: ['A', 'B', 'C', 'D'] })
    expect(result.layout?.maxSessions).toBe(4)
    expect(result.layout?.tiles.map(t => [t.width, t.height])).toEqual(Array(4).fill([360, 420]))
    const root = useMosaicStore.getState().root
    area = { ...area, width: 720 }
    await expect(act({ action: 'split_session', sessionIds: ['A', 'B', 'C'] })).rejects.toThrow(/capacity.*2/i)
    expect(useMosaicStore.getState().root).toBe(root)
    area = { ...area, width: 721, height: 840 }
    await expect(act({ action: 'split_session', sessionIds: ['A', 'B', 'C'] })).rejects.toThrow(/capacity.*2/i)
    expect(useMosaicStore.getState().root).toBe(root)
  })

  it('limits capacity to the card area actually inside the current viewport', async () => {
    window.innerWidth = 900
    const snapshot = await layoutSnapshotForTarget(caller)
    expect(snapshot.layout.area).toMatchObject({ x: 320, width: 580 })
    expect(snapshot.layout.maxSessions).toBe(2)
    const root = useMosaicStore.getState().root
    await expect(act({ action: 'split_session', sessionIds: ['A', 'B', 'C'] })).rejects.toThrow(/capacity.*2/)
    expect(useMosaicStore.getState().root).toBe(root)
  })

  it('retains divider ids through resizing/focus and rejects a removed divider id', async () => {
    const before = (await layoutSnapshotForTarget(caller)).layout!
    const divider = before.dividers[0]!
    const result = await act({ action: 'resize_splits', dividers: [{ id: divider.id, ratio: 0.6 }] })
    expect(result.layout?.dividers[0]?.id).toBe(divider.id)
    await act({ action: 'focus_session', target: local('B') })
    expect((await layoutSnapshotForTarget(caller)).layout?.dividers[0]?.id).toBe(divider.id)
    await act({ action: 'split_session', target: 'foreground', sessionIds: ['B', 'C', 'D'] })
    const root = useMosaicStore.getState().root
    await expect(act({ action: 'resize_splits', target: 'foreground', dividers: [{ id: divider.id, ratio: 0.5 }] })).rejects.toThrow(/stale/)
    expect(useMosaicStore.getState().root).toBe(root)
  })

  it('checks a child resize against its proposed parent size rather than the old size', async () => {
    area = { ...area, width: 2000 }
    await act({ action: 'split_session', sessionIds: ['A', 'B', 'C'] })
    const snap = (await layoutSnapshotForTarget(caller)).layout!
    const [parent, child] = snap.dividers
    await act({ action: 'resize_splits', dividers: [{ id: parent.id, ratio: 0.2 }, { id: child.id, ratio: 0.7 }] })
    await expect(act({ action: 'resize_splits', dividers: [{ id: parent.id, ratio: 0.5 }] })).rejects.toThrow(/minimum/)
    const result = await act({ action: 'resize_splits', dividers: [{ id: parent.id, ratio: 0.5 }, { id: child.id, ratio: 0.5 }] })
    expect(result.layout?.tiles.every(t => t.width >= 360)).toBe(true)
  })

  it('refuses invalid close batches without removing a tile and keeps the foreground for closeAll while maximized', async () => {
    const root = useMosaicStore.getState().root
    await expect(act({ action: 'close_split', sessionIds: ['B', 'C'] })).rejects.toThrow(/not in/)
    expect(useMosaicStore.getState().root).toBe(root)
    await act({ action: 'maximize_split', target: local('A') })
    await act({ action: 'close_split', closeAll: true })
    expect(useMosaicStore.getState()).toMatchObject({ mode: 'single', lastLayout: null })
    expect(useChatStore.getState().projectSessions['/p']._activeSessionId).toBe('A')
  })

  it('does not let a hidden caller reshape the foreground or restore disabled remote tiles', async () => {
    await act({ action: 'split_session', sessionIds: ['A', { environmentId: 'node', sessionId: 'B' }] })
    await act({ action: 'maximize_split', target: local('A') })
    useAppStore.setState({ experimentalRemoteNodesEnabled: false })
    await expect(act({ action: 'restore_splits' })).rejects.toThrow(/disabled/)
    expect(useMosaicStore.getState().mode).toBe('single')
    useAppStore.setState({ experimentalRemoteNodesEnabled: true })
    expect(await layoutActForTarget({ ...caller, sessionId: 'C' }, { action: 'close_split', closeAll: true })).toMatchObject({ status: 'skipped', reason: 'not_visible' })
    expect(useMosaicStore.getState().lastLayout).not.toBeNull()
  })

  it('reads actual committed tile/divider geometry and never uses hidden saved DOM geometry', async () => {
    const root = useMosaicStore.getState().root!
    const host = document.createElement('div')
    const left = document.createElement('div')
    left.dataset.tileId = tile('A').id
    const right = document.createElement('div')
    right.dataset.tileId = tile('B').id
    const divider = document.createElement('div')
    divider.dataset.mosaicPath = ''
    host.append(left, divider, right)
    document.body.append(host)
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ x: 320, y: 5, left: 320, top: 5, width: 1200, height: 900 } as DOMRect)
    vi.spyOn(left, 'getBoundingClientRect').mockReturnValue({ x: 320, y: 5, left: 320, top: 5, width: 500, height: 900 } as DOMRect)
    vi.spyOn(right, 'getBoundingClientRect').mockReturnValue({ x: 821, y: 5, left: 821, top: 5, width: 699, height: 900 } as DOMRect)
    vi.spyOn(divider, 'getBoundingClientRect').mockReturnValue({ x: 820, y: 5, width: 1, height: 900 } as DOMRect)
    const release = registerMosaicDom(root, host, true)
    try {
      const snapshot = await layoutSnapshotForTarget(caller)
      expect(snapshot.layout.tiles.map(t => [t.x, t.width])).toEqual([[0, 500], [501, 699]])
      expect(snapshot.layout.dividers[0]).toMatchObject({ x: 500, width: 1, height: 900 })
      const result = await act({ action: 'maximize_split', target: local('A') })
      expect(result.layout?.tiles).toHaveLength(1)
      expect(result.layout?.saved?.tiles[1]).not.toHaveProperty('width')
      expect(result.layout?.dividers).toEqual([])
    } finally { release() }
  })

  it('returns single mode for a one-session batch, errors on standalone maximize, and treats restore as a no-op', async () => {
    const result = await act({ action: 'split_session', sessionIds: ['A'] })
    expect(result.layout?.mode).toBe('single')
    expect(useMosaicStore.getState()).toMatchObject({ root: null, lastLayout: null })
    await expect(act({ action: 'maximize_split', target: local('A') })).rejects.toThrow(/requires a split layout/)
    expect(await act({ action: 'restore_splits' })).toMatchObject({ status: 'applied', layout: { mode: 'single' } })
  })

  it('does not invent visible geometry in Settings or let compact-window operations reshape the mosaic', async () => {
    useAppStore.setState({ view: 'settings' })
    const snapshot = await layoutSnapshotForTarget(caller)
    expect(snapshot.layout.tiles).toEqual([])
    expect(snapshot.layout.dividers).toEqual([])
    useAppStore.setState({ view: 'main' })
    useWindowMiniModeStore.setState({ phase: 'mini' })
    const compact = await layoutSnapshotForTarget(caller)
    expect(compact.layout.mode).toBe('maximized')
    expect(compact.layout.tiles).toHaveLength(1)
    expect(compact.layout.saved?.tiles).toHaveLength(2)
    const root = useMosaicStore.getState().root
    await expect(act({ action: 'restore_splits' })).rejects.toThrow(/full window/)
    expect(useMosaicStore.getState().root).toBe(root)
  })
})
