import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ActivityPanelSide = 'left' | 'right'

interface ActivityPanelState {
  showPanel: boolean
  side: ActivityPanelSide
  panelWidth: number

  setShowPanel: (show: boolean) => void
  setSide: (side: ActivityPanelSide) => void
  setPanelWidth: (w: number) => void
  toggleSide: () => void
}

export const useActivityPanelStore = create<ActivityPanelState>()(
  persist(
    (set, get) => ({
      showPanel: false,
      side: 'left',
      panelWidth: 560,

      setShowPanel: (show) => set({ showPanel: show }),
      setSide: (side) => set({ side }),
      setPanelWidth: (w) => set({ panelWidth: w }),
      toggleSide: () => set({ side: get().side === 'left' ? 'right' : 'left' }),
    }),
    {
      name: 'activity-panel',
      partialize: ({ side, panelWidth }) => ({ side, panelWidth }),
    },
  ),
)
