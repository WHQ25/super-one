import { create } from 'zustand'
import type { SerializedDockview } from 'dockview-core'
import { applyDockSnapshot, getDockSnapshot, isDockReady, setOnDockReady } from '@/components/activity/activity-panel-api'
import { useActivityPanelStore } from './activity-panel'

export interface SessionViewState {
  layout: SerializedDockview | null
  showPanel: boolean
}

interface ActivityViewStateStore {
  perSession: Record<string, SessionViewState>
  pendingRestore: string | null
  park: (sessionId: string) => void
  restore: (sessionId: string) => void
  seedFromCurrent: (sessionId: string) => void
  clearForSession: (sessionId: string) => void
  flushPending: () => void
  _resetForTest: () => void
}

function applyState(state: SessionViewState | undefined) {
  applyDockSnapshot(state?.layout ?? null)
  useActivityPanelStore.getState().setShowPanel(state?.showPanel ?? false)
}

export const useActivityViewStateStore = create<ActivityViewStateStore>((set, get) => ({
  perSession: {},
  pendingRestore: null,

  park: (sessionId) => {
    if (!isDockReady()) return
    const layout = getDockSnapshot()
    const showPanel = useActivityPanelStore.getState().showPanel
    set((s) => ({
      perSession: {
        ...s.perSession,
        [sessionId]: { layout: layout ? structuredClone(layout) : null, showPanel },
      },
    }))
  },

  restore: (sessionId) => {
    if (!isDockReady()) {
      set({ pendingRestore: sessionId })
      return
    }
    set({ pendingRestore: null })
    const target = get().perSession[sessionId]
    applyState(target ? { layout: target.layout ? structuredClone(target.layout) : null, showPanel: target.showPanel } : undefined)
  },

  seedFromCurrent: (sessionId) => {
    if (!isDockReady()) return
    const layout = getDockSnapshot()
    const showPanel = useActivityPanelStore.getState().showPanel
    set((s) => ({
      perSession: {
        ...s.perSession,
        [sessionId]: { layout: layout ? structuredClone(layout) : null, showPanel },
      },
    }))
  },

  clearForSession: (sessionId) => {
    set((s) => {
      if (!(sessionId in s.perSession)) return s
      const { [sessionId]: _removed, ...rest } = s.perSession
      const next: Partial<ActivityViewStateStore> = { perSession: rest }
      if (s.pendingRestore === sessionId) next.pendingRestore = null
      return next
    })
  },

  flushPending: () => {
    const state = get()
    if (!state.pendingRestore) return
    const sid = state.pendingRestore
    set({ pendingRestore: null })
    const target = state.perSession[sid]
    applyState(target ? { layout: target.layout ? structuredClone(target.layout) : null, showPanel: target.showPanel } : undefined)
  },

  _resetForTest: () => set({ perSession: {}, pendingRestore: null }),
}))

setOnDockReady(() => {
  useActivityViewStateStore.getState().flushPending()
})
