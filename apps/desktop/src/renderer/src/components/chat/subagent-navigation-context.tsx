import { createContext, useContext } from 'react'

export interface SubagentViewState {
  toolUseId: string
}

export interface SubagentNavigation {
  current: SubagentViewState | null
  open: (state: SubagentViewState) => void
  close: () => void
}

export const SubagentNavigationContext = createContext<SubagentNavigation>({
  current: null,
  open: () => {},
  close: () => {},
})

export function useSubagentNavigation(): SubagentNavigation {
  return useContext(SubagentNavigationContext)
}
