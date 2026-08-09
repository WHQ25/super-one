import { createContext, useContext } from 'react'

export interface WorkflowViewState {
  toolUseId: string
  transcriptDir?: string
  name: string
  /** Inline script body when already known (Claude tool input or preloaded). */
  script?: string
  /** Absolute path to load when `script` is missing (Grok script.rhai / library path). */
  scriptPath?: string
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
