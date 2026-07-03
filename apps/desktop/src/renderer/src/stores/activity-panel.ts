import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ActivityPanelSide = 'left' | 'right'

interface ActivityPanelState {
  showPanel: boolean
  side: ActivityPanelSide
  panelWidth: number
  hasPanels: boolean
  userResized: boolean

  setShowPanel: (show: boolean) => void
  setSide: (side: ActivityPanelSide) => void
  setPanelWidth: (w: number) => void
  setPanelWidthByUser: (w: number) => void
  resetUserResized: () => void
  toggleSide: () => void
  setHasPanels: (has: boolean) => void
}

export const useActivityPanelStore = create<ActivityPanelState>()(
  persist(
    (set, get) => ({
      showPanel: false,
      side: 'left',
      panelWidth: 560,
      hasPanels: false,
      userResized: false,

      setShowPanel: (show) => set({ showPanel: show }),
      setSide: (side) => set({ side }),
      setPanelWidth: (w) => set({ panelWidth: w }),
      setPanelWidthByUser: (w) => set({ panelWidth: w, userResized: true }),
      resetUserResized: () => set({ userResized: false }),
      toggleSide: () => set({ side: get().side === 'left' ? 'right' : 'left' }),
      setHasPanels: (has) => set({ hasPanels: has }),
    }),
    {
      name: 'activity-panel',
      partialize: ({ side, panelWidth }) => ({ side, panelWidth }),
    },
  ),
)
