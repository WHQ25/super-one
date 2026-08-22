import { create } from 'zustand'
import type { DeviceProvider } from '@superone/shared/device'

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
  /**
   * The device on screen, so the tab can name and draw it.
   *
   * Sent through the same wire as the refresh button rather than through the instance
   * store, because it is the same fact for the same reason: the panel holds the device
   * LIST, and the tab holds the pixels. The store knows which device id a tab points
   * at, but an id is not a name — resolving it would have every tab re-read the
   * catalogue to render one word.
   *
   * Null while the panel is empty, which is when the tab falls back to "Device".
   */
  device: { name: string; provider: DeviceProvider; kind: string } | null
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
