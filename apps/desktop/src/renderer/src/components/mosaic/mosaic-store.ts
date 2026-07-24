import { create } from 'zustand'
import { useChatStore } from '@/stores/chat'
import {
  addLeaf,
  removeLeafRebalanced,
  replaceLeaf,
  setRatioAtPath,
  collectLeaves,
  leafCount,
  findLeaf,
  makeLeaf,
  type DropEdge,
  type DropPlan,
  type MosaicNode,
  type MosaicPath,
} from './mosaic-tree'

export const mosaicTileId = (projectPath: string, sessionId: string): string => `${projectPath} ${sessionId}`

export const SESSION_DRAG_MIME = 'application/x-superone-session'

interface DropTarget {
  tileId?: string
  edge: DropEdge
}

function currentActiveSeed(): { projectPath: string; sessionId: string } | null {
  const chat = useChatStore.getState()
  const projectPath = chat.activeProject
  if (!projectPath) return null
  const sessionId = chat.projectSessions[projectPath]?._activeSessionId
  if (!sessionId) return null
  return { projectPath, sessionId }
}

interface MosaicState {
  mode: 'single' | 'mosaic'
  root: MosaicNode | null
  focusedTileId: string | null
  lastLayout: { root: MosaicNode; focusedTileId: string | null } | null
  draggingSession: boolean
  draggedSession: { projectPath: string; sessionId: string } | null
  dropHint: DropPlan | null
  addTile: (projectPath: string, sessionId: string, target?: DropTarget) => void
  removeTile: (id: string) => void
  setFocus: (id: string) => void
  setRatio: (path: MosaicPath, ratio: number) => void
  setDragging: (dragging: boolean, session?: { projectPath: string; sessionId: string } | null) => void
  setDropHint: (hint: DropPlan | null) => void
  exitToSingle: () => void
  restoreLayout: () => void
  focusOrReplaceFocused: (projectPath: string, sessionId: string) => boolean
  replaceTileSession: (projectPath: string, previousSessionId: string, sessionId: string) => boolean
}

/**
 * A drop changes nothing when the session is already a tile, or — in single mode
 * — there is no *distinct* active session to split it against. A lone tile would
 * masquerade as single mode while dropping the per-session header menu, so we
 * refuse to create one (both here and as a drop-hint suppressor in the zone).
 */
export function dropWouldNoOp(projectPath: string, sessionId: string): boolean {
  const st = useMosaicStore.getState()
  if (st.root && findLeaf(st.root, mosaicTileId(projectPath, sessionId))) return true
  if (st.mode !== 'mosaic' || !st.root) {
    const active = currentActiveSeed()
    return !active || (active.projectPath === projectPath && active.sessionId === sessionId)
  }
  return false
}

export const useMosaicStore = create<MosaicState>((set, get) => ({
  mode: 'single',
  root: null,
  focusedTileId: null,
  lastLayout: null,
  draggingSession: false,
  draggedSession: null,
  dropHint: null,

  addTile: (projectPath, sessionId, target) => {
    const id = mosaicTileId(projectPath, sessionId)
    const st = get()
    const chat = useChatStore.getState()
    // Re-dropping a session that is already a tile is a pure no-op.
    if (st.root && findLeaf(st.root, id)) return

    if (st.mode !== 'mosaic' || !st.root) {
      const active = currentActiveSeed()
      // No distinct active session to split against — open it in single mode
      // rather than spawning a lone-tile mosaic.
      if (!active || (active.projectPath === projectPath && active.sessionId === sessionId)) {
        void chat.switchToSession(projectPath, sessionId)
        return
      }
      const activeId = mosaicTileId(active.projectPath, active.sessionId)
      void chat.mountSession(projectPath, sessionId)
      void chat.mountSession(active.projectPath, active.sessionId)
      const activeLeaf = makeLeaf(activeId, active.projectPath, active.sessionId)
      set({ mode: 'mosaic', root: addLeaf(activeLeaf, activeId, target?.edge ?? 'right', makeLeaf(id, projectPath, sessionId)), focusedTileId: id, lastLayout: null })
    } else {
      void chat.mountSession(projectPath, sessionId)
      const targetId = target?.tileId ?? st.focusedTileId ?? collectLeaves(st.root)[0]?.id
      const root = targetId ? addLeaf(st.root, targetId, target?.edge ?? 'right', makeLeaf(id, projectPath, sessionId)) : st.root
      set({ root, focusedTileId: id })
    }
    void chat.switchToSession(projectPath, sessionId)
  },

  setFocus: (id) => {
    const st = get()
    const leaf = st.root && findLeaf(st.root, id)
    if (!leaf) return
    set({ focusedTileId: id })
    void useChatStore.getState().switchToSession(leaf.projectPath, leaf.sessionId)
  },

  removeTile: (id) => {
    const st = get()
    if (!st.root) return
    const leaf = findLeaf(st.root, id)
    if (!leaf) return
    const chat = useChatStore.getState()
    chat.unmountSession(leaf.projectPath, leaf.sessionId)
    const next = removeLeafRebalanced(st.root, id)
    if (!next || leafCount(next) <= 1) {
      const last = next ? collectLeaves(next)[0] : null
      set({ mode: 'single', root: null, focusedTileId: null, lastLayout: null })
      if (last) {
        chat.unmountSession(last.projectPath, last.sessionId)
        void chat.switchToSession(last.projectPath, last.sessionId)
      }
      return
    }
    let focusedTileId = st.focusedTileId
    if (focusedTileId === id) {
      const ft = collectLeaves(next)[0]
      focusedTileId = ft?.id ?? null
      if (ft) void chat.switchToSession(ft.projectPath, ft.sessionId)
    }
    set({ root: next, focusedTileId })
  },

  setRatio: (path, ratio) => {
    const st = get()
    if (!st.root) return
    set({ root: setRatioAtPath(st.root, path, ratio) })
  },

  setDragging: (dragging, session) => set({
    draggingSession: dragging,
    draggedSession: dragging ? (session ?? null) : null,
    dropHint: dragging ? get().dropHint : null,
  }),

  setDropHint: (hint) => set({ dropHint: hint }),

  exitToSingle: () => {
    const st = get()
    if (st.mode !== 'mosaic' || !st.root) return
    const chat = useChatStore.getState()
    const leaves = collectLeaves(st.root)
    for (const t of leaves) chat.unmountSession(t.projectPath, t.sessionId)
    const focused = st.focusedTileId ? findLeaf(st.root, st.focusedTileId) : null
    set({ mode: 'single', root: null, focusedTileId: null, lastLayout: { root: st.root, focusedTileId: st.focusedTileId } })
    if (focused) void chat.switchToSession(focused.projectPath, focused.sessionId)
  },

  restoreLayout: () => {
    const st = get()
    if (st.mode === 'mosaic' || !st.lastLayout) return
    const chat = useChatStore.getState()
    const { focusedTileId } = st.lastLayout
    // The single view occupied the slot of the tile focused on exit. Whatever
    // session the user navigated to there owns that slot on the way back: if it
    // is already in the layout we just focus it, otherwise it replaces the slot.
    let root = st.lastLayout.root
    let targetId = focusedTileId
    const active = currentActiveSeed()
    if (active) {
      const activeId = mosaicTileId(active.projectPath, active.sessionId)
      if (findLeaf(root, activeId)) {
        targetId = activeId
      } else {
        const slotId = (focusedTileId && findLeaf(root, focusedTileId)?.id) || collectLeaves(root)[0]?.id
        if (slotId) {
          root = replaceLeaf(root, slotId, makeLeaf(activeId, active.projectPath, active.sessionId))
          targetId = activeId
        }
      }
    }
    const leaves = collectLeaves(root)
    for (const t of leaves) void chat.mountSession(t.projectPath, t.sessionId)
    const target = (targetId && findLeaf(root, targetId)) || leaves[0]
    set({ mode: 'mosaic', root, focusedTileId: target?.id ?? null, lastLayout: null })
    if (target) void chat.switchToSession(target.projectPath, target.sessionId)
  },

  focusOrReplaceFocused: (projectPath, sessionId) => {
    const st = get()
    if (st.mode !== 'mosaic' || !st.root) return false
    const targetId = mosaicTileId(projectPath, sessionId)
    // Target already lives in the mosaic — just move focus there.
    if (findLeaf(st.root, targetId)) {
      get().setFocus(targetId)
      return true
    }
    // Otherwise swap the focused tile's session for the target, keeping the
    // split-tree shape (ratios, siblings) intact.
    const focusId = (st.focusedTileId && findLeaf(st.root, st.focusedTileId)?.id) || collectLeaves(st.root)[0]?.id
    if (!focusId) return false
    const chat = useChatStore.getState()
    const previous = findLeaf(st.root, focusId)
    void chat.mountSession(projectPath, sessionId)
    set({ root: replaceLeaf(st.root, focusId, makeLeaf(targetId, projectPath, sessionId)), focusedTileId: targetId })
    if (previous) chat.unmountSession(previous.projectPath, previous.sessionId)
    void chat.switchToSession(projectPath, sessionId)
    return true
  },

  replaceTileSession: (projectPath, previousSessionId, sessionId) => {
    const st = get()
    if (!st.root || previousSessionId === sessionId) return false
    const previousTileId = mosaicTileId(projectPath, previousSessionId)
    const nextTileId = mosaicTileId(projectPath, sessionId)
    if (!findLeaf(st.root, previousTileId) || findLeaf(st.root, nextTileId)) return false
    const chat = useChatStore.getState()
    void chat.mountSession(projectPath, sessionId)
    chat.unmountSession(projectPath, previousSessionId)
    set({
      root: replaceLeaf(st.root, previousTileId, makeLeaf(nextTileId, projectPath, sessionId)),
      focusedTileId: st.focusedTileId === previousTileId ? nextTileId : st.focusedTileId,
    })
    return true
  },
}))
