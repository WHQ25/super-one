import { createContext, useContext } from 'react'

export interface WorkflowViewState {
  toolUseId: string
  transcriptDir?: string
  name: string
  script?: string
}

export interface WorkflowNavigation {
  current: WorkflowViewState | null
  open: (state: WorkflowViewState) => void
  close: () => void
}

export const WorkflowNavigationContext = createContext<WorkflowNavigation>({
  current: null,
  open: () => {},
  close: () => {},
})

export function useWorkflowNavigation(): WorkflowNavigation {
  return useContext(WorkflowNavigationContext)
}
