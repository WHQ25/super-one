import { create } from 'zustand'

export type DropPosition = 'left' | 'right' | 'top' | 'bottom' | 'center'

export interface DropIndicator {
  left: number
  top: number
  width: number
  height: number
  position: DropPosition
}

interface ActivityDropState {
  indicator: DropIndicator | null
  tabDragging: boolean
  floatingPanelId: string | null
  setIndicator: (r: DropIndicator | null) => void
  setTabDragging: (dragging: boolean) => void
  setFloatingPanelId: (id: string | null) => void
}

export const useActivityDropStore = create<ActivityDropState>((set) => ({
  indicator: null,
  tabDragging: false,
  floatingPanelId: null,
  setIndicator: (indicator) => set({ indicator }),
  setTabDragging: (tabDragging) => set({ tabDragging }),
  setFloatingPanelId: (floatingPanelId) => set({ floatingPanelId }),
}))
