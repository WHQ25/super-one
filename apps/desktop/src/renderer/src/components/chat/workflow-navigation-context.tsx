import { createContext, useContext } from 'react'
import type { WorkflowHarnessKind } from './workflow-utils'

export interface WorkflowViewState {
  toolUseId: string
  harness?: WorkflowHarnessKind
  transcriptDir?: string
  logPath?: string
  inlineSummary?: string
  runKey?: string
  name: string
  script?: string
  scriptPath?: string
  scriptCandidates?: string[]
  agentId?: string
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
