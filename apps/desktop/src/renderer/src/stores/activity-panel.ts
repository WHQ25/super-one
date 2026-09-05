import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { LAYOUT } from '@/lib/layout-constants'

export type ActivityPanelSide = 'left' | 'right'

/** Viewport-space bounds, in the same frame as the host-layer slot rects. */
export interface ActivityPanelBounds {
  left: number
  top: number
  width: number
  height: number
}

interface ActivityPanelState {
  showPanel: boolean
  side: ActivityPanelSide
  panelWidth: number
  hasPanels: boolean
  userResized: boolean
  maximized: boolean
  maximizedGroupId: string | null
  /**
   * Where the panel is on screen. Published because the browser and mini-app
   * webviews live in host layers OUTSIDE the panel's clipping box, so each one
   * has to work out for itself whether it sits on the card's rounded corner.
   */
  bounds: ActivityPanelBounds | null

  setShowPanel: (show: boolean) => void
  setSide: (side: ActivityPanelSide) => void
  setPanelWidth: (w: number) => void
  setPanelWidthByUser: (w: number) => void
  resetUserResized: () => void
  toggleSide: () => void
  setHasPanels: (has: boolean) => void
  setMaximizedGroup: (groupId: string | null) => void
  setBounds: (bounds: ActivityPanelBounds | null) => void
}

export const useActivityPanelStore = create<ActivityPanelState>()(
  persist(
    (set, get) => ({
      showPanel: false,
      side: 'left',
      panelWidth: 560,
      hasPanels: false,
      userResized: false,
      maximized: false,
      maximizedGroupId: null,
      bounds: null,

      setShowPanel: (show) => set((state) => ({
        showPanel: show,
        maximized: show ? state.maximized : false,
        maximizedGroupId: show ? state.maximizedGroupId : null,
      })),
      setSide: (side) => set({ side }),
      setPanelWidth: (w) => set({ panelWidth: w }),
      setPanelWidthByUser: (w) => set({ panelWidth: w, userResized: true }),
      resetUserResized: () => set({ userResized: false }),
      toggleSide: () => set({ side: get().side === 'left' ? 'right' : 'left' }),
      setHasPanels: (has) => set((state) => ({
        hasPanels: has,
        maximized: has ? state.maximized : false,
        maximizedGroupId: has ? state.maximizedGroupId : null,
      })),
      setMaximizedGroup: (groupId) => set((state) => ({
        maximized: groupId !== null && state.showPanel,
        maximizedGroupId: state.showPanel ? groupId : null,
      })),
      // Measured every frame the layout moves, so it is compared before it is
      // stored — consumers re-render on identity and the rect is usually equal.
      setBounds: (bounds) => set((state) => {
        const prev = state.bounds
        if (prev === bounds) return state
        if (prev && bounds && prev.left === bounds.left && prev.top === bounds.top
          && prev.width === bounds.width && prev.height === bounds.height) return state
        return { bounds }
      }),
    }),
    {
      name: 'activity-panel',
      partialize: ({ side, panelWidth }) => ({ side, panelWidth }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ActivityPanelState>
        return {
          ...current,
          ...saved,
          panelWidth: Math.max(LAYOUT.MIN_AP, saved.panelWidth ?? current.panelWidth),
        }
      },
    },
  ),
)
