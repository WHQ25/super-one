import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MosaicBranch } from './mosaic-tree'

const chat = {
  activeProject: '/p' as string | null,
  projectSessions: { '/p': { _activeSessionId: 's-active' } } as Record<string, { _activeSessionId: string | null }>,
  mountSession: vi.fn().mockResolvedValue(undefined),
  unmountSession: vi.fn(),
  switchToSession: vi.fn().mockResolvedValue(undefined),
}

vi.mock('@/stores/chat', () => ({ useChatStore: { getState: () => chat } }))

import { useMosaicStore, mosaicTileId } from './mosaic-store'
import { collectLeaves, findLeaf } from './mosaic-tree'

const resetStore = () => useMosaicStore.setState({ mode: 'single', root: null, focusedTileId: null, draggingSession: false, draggedSession: null })

describe('mosaic-store addTile', () => {
  beforeEach(() => {
    resetStore()
    chat.activeProject = '/p'
    chat.projectSessions = { '/p': { _activeSessionId: 's-active' } }
    vi.clearAllMocks()
  })

  it('splits the active session against the new one by the given edge on first drop', () => {
    useMosaicStore.getState().addTile('/p', 's-new', { edge: 'bottom' })
    const st = useMosaicStore.getState()
    expect(st.mode).toBe('mosaic')
    const root = st.root as MosaicBranch
    expect(root.direction).toBe('column')
    expect(root.first).toMatchObject({ sessionId: 's-active' })
    expect(root.second).toMatchObject({ sessionId: 's-new' })
    expect(st.focusedTileId).toBe(mosaicTileId('/p', 's-new'))
    expect(chat.mountSession).toHaveBeenCalledWith('/p', 's-active')
    expect(chat.mountSession).toHaveBeenCalledWith('/p', 's-new')
  })

  it('inserts beside the targeted tile when already in mosaic mode', () => {
    useMosaicStore.getState().addTile('/p', 's-new', { edge: 'right' })
    const firstId = mosaicTileId('/p', 's-active')
    useMosaicStore.getState().addTile('/p', 's-third', { tileId: firstId, edge: 'left' })
    const root = useMosaicStore.getState().root!
    expect(collectLeaves(root).map((l) => l.sessionId).sort()).toEqual(['s-active', 's-new', 's-third'])
    expect(findLeaf(root, mosaicTileId('/p', 's-third'))).toBeTruthy()
  })

  it('does nothing when re-dropping a session already in the mosaic', () => {
    useMosaicStore.getState().addTile('/p', 's-new', { edge: 'right' })
    const before = useMosaicStore.getState()
    const beforeRoot = before.root
    const beforeFocus = before.focusedTileId
    useMosaicStore.getState().addTile('/p', 's-active', { edge: 'top' })
    const st = useMosaicStore.getState()
    expect(st.root).toBe(beforeRoot)
    expect(st.focusedTileId).toBe(beforeFocus)
  })

  it('stays in single mode when the dropped session is the active one', () => {
    useMosaicStore.getState().addTile('/p', 's-active', { edge: 'right' })
    const st = useMosaicStore.getState()
    expect(st.mode).toBe('single')
    expect(st.root).toBeNull()
    expect(chat.switchToSession).toHaveBeenCalledWith('/p', 's-active')
  })
})

describe('mosaic-store removeTile', () => {
  beforeEach(() => {
    resetStore()
    chat.activeProject = '/p'
    chat.projectSessions = { '/p': { _activeSessionId: 's-active' } }
    vi.clearAllMocks()
  })

  it('returns to single mode when the tree collapses to one leaf', () => {
    useMosaicStore.getState().addTile('/p', 's-new', { edge: 'right' })
    useMosaicStore.getState().removeTile(mosaicTileId('/p', 's-new'))
    const st = useMosaicStore.getState()
    expect(st.mode).toBe('single')
    expect(st.root).toBeNull()
    expect(chat.switchToSession).toHaveBeenLastCalledWith('/p', 's-active')
  })

  it('keeps mosaic mode and reassigns focus when more than one leaf remains', () => {
    useMosaicStore.getState().addTile('/p', 's-b', { edge: 'right' })
    useMosaicStore.getState().addTile('/p', 's-c', { tileId: mosaicTileId('/p', 's-b'), edge: 'bottom' })
    useMosaicStore.getState().removeTile(mosaicTileId('/p', 's-c'))
    const st = useMosaicStore.getState()
    expect(st.mode).toBe('mosaic')
    expect(collectLeaves(st.root!).map((l) => l.sessionId).sort()).toEqual(['s-active', 's-b'])
  })
})
