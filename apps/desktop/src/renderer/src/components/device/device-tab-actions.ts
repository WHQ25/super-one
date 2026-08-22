import { create } from 'zustand'

/**
 * The panel owns the device list; the dockview tab owns the only spare pixels. This
 * is the wire between them — the same shape `useMiniAppStore.devControls` uses for
 * the mini-app tab's reload and devtools buttons.
 *
 * Keyed by session because one dock can hold a simulator panel per session, and the
 * tab that draws the button has no way to reach into the panel body's React tree.
 */
export interface DeviceTabActions {
  refresh: () => void
  /** Spins the icon. The panel is the only thing that knows a read is in flight. */
  busy: boolean
}

interface DeviceTabActionsState {
  bySession: Record<string, DeviceTabActions>
  register: (sessionId: string, actions: DeviceTabActions) => void
  unregister: (sessionId: string) => void
}

export const useDeviceTabActions = create<DeviceTabActionsState>((set) => ({
  bySession: {},
  register: (sessionId, actions) =>
    set((state) => ({ bySession: { ...state.bySession, [sessionId]: actions } })),
  unregister: (sessionId) =>
    set((state) => {
      if (!(sessionId in state.bySession)) return state
      const next = { ...state.bySession }
      delete next[sessionId]
      return { bySession: next }
    }),
}))
