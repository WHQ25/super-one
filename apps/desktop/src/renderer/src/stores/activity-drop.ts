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
  setIndicator: (r: DropIndicator | null) => void
}

export const useActivityDropStore = create<ActivityDropState>((set) => ({
  indicator: null,
  setIndicator: (indicator) => set({ indicator }),
}))
