import { createContext, useContext } from 'react'
import type { CodexPlanApprovalState } from '@superone/shared/agent-types'

interface PlanFooterActions {
  onApprove?: () => void
  onReject?: (feedback?: string) => void
  planApproval?: CodexPlanApprovalState
}

export type PlanFullscreenContextValue = {
  open: (text: string, actions?: PlanFooterActions) => void
}

export const PlanFullscreenContext = createContext<PlanFullscreenContextValue>({ open: () => {} })
export const usePlanFullscreen = () => useContext(PlanFullscreenContext)
