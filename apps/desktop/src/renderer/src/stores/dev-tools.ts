import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DevToolsState {
  reactScan: boolean
  toggleReactScan: () => void
}

export const useDevToolsStore = create<DevToolsState>()(
  persist(
    (set) => ({
      reactScan: false,
      toggleReactScan: () => set((s) => ({ reactScan: !s.reactScan })),
    }),
    { name: 'superone-devtools' },
  ),
)
