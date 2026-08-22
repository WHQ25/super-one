import { create } from 'zustand'

/**
 * The panel owns the device list; the dockview tab owns the only spare pixels. This
 * is the wire between them — the same shape `useMiniAppStore.devControls` uses for
 * the mini-app tab's reload and devtools buttons.
 *
 * Keyed by instance because one session can hold several device panels, and the tab
 * that draws the button has no way to reach into the panel body's React tree.
 */
export interface DeviceTabActions {
  refresh: () => void
  /** Spins the icon. The panel is the only thing that knows a read is in flight. */
  busy: boolean
}

interface DeviceTabActionsState {
  byInstance: Record<string, DeviceTabActions>
  register: (instanceId: string, actions: DeviceTabActions) => void
  unregister: (instanceId: string) => void
}

export const useDeviceTabActions = create<DeviceTabActionsState>((set) => ({
  byInstance: {},
  register: (instanceId, actions) =>
    set((state) => ({ byInstance: { ...state.byInstance, [instanceId]: actions } })),
  unregister: (instanceId) =>
    set((state) => {
      if (!(instanceId in state.byInstance)) return state
      const next = { ...state.byInstance }
      delete next[instanceId]
      return { byInstance: next }
    }),
}))
