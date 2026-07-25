import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ActivityPanelSide = 'left' | 'right'

interface ActivityPanelState {
  showPanel: boolean
  side: ActivityPanelSide
  panelWidth: number
  hasPanels: boolean
  userResized: boolean
  maximized: boolean
  maximizedGroupId: string | null

  setShowPanel: (show: boolean) => void
  setSide: (side: ActivityPanelSide) => void
  setPanelWidth: (w: number) => void
  setPanelWidthByUser: (w: number) => void
  resetUserResized: () => void
  toggleSide: () => void
  setHasPanels: (has: boolean) => void
  setMaximizedGroup: (groupId: string | null) => void
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
    }),
    {
      name: 'activity-panel',
      partialize: ({ side, panelWidth }) => ({ side, panelWidth }),
    },
  ),
)
