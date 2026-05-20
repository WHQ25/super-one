import { createContext, useContext } from 'react'

export interface ForkViewState {
  collabId: string
  threadId: string
}

export interface ForkNavigation {
  current: ForkViewState | null
  open: (state: ForkViewState) => void
  close: () => void
}

export const ForkNavigationContext = createContext<ForkNavigation>({
  current: null,
  open: () => {},
  close: () => {},
})

export function useForkNavigation(): ForkNavigation {
  return useContext(ForkNavigationContext)
}
