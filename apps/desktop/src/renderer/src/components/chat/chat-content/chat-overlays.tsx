import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import type { CodexPlanApprovalState } from '@superone/shared/agent-types'
import { PlanApprovalPrompt } from '../PlanApprovalPrompt'
import { PlanFullscreenContext } from '../plan-fullscreen-context'
import { CodexPlanFullscreenView } from '../CodexPlanFullscreenView'
import { SubagentNavigationContext, type SubagentViewState } from '../subagent-navigation-context'
import { SubagentFullView } from '../SubagentFullView'
import { WorkflowNavigationContext, type WorkflowViewState } from '../workflow-navigation-context'

const WorkflowFullView = lazy(() =>
  import('../WorkflowFullView').then((m) => ({ default: m.WorkflowFullView })),
)

export interface FullscreenPlanState {
  text: string
  onApprovePlan?: () => void
  onRejectPlan?: (feedback?: string) => void
  planApproval?: CodexPlanApprovalState
}

export function useChatOverlays(displayedSessionId: string | null | undefined) {
  const [fullscreenPlan, setFullscreenPlan] = useState<FullscreenPlanState | null>(null)
  const planFullscreenCtx = useMemo(
    () => ({
      open: (
        text: string,
        actions?: {
          onApprove?: () => void
          onReject?: (feedback?: string) => void
          planApproval?: CodexPlanApprovalState
        },
      ) =>
        setFullscreenPlan({
          text,
          onApprovePlan: actions?.onApprove,
          onRejectPlan: actions?.onReject,
          planApproval: actions?.planApproval,
        }),
    }),
    [],
  )

  const [subagentView, setSubagentView] = useState<SubagentViewState | null>(null)
  const subagentNav = useMemo(
    () => ({
      current: subagentView,
      open: (state: SubagentViewState) => setSubagentView(state),
      close: () => setSubagentView(null),
    }),
    [subagentView],
  )

  const [workflowView, setWorkflowView] = useState<WorkflowViewState | null>(null)
  const workflowNav = useMemo(
    () => ({
      current: workflowView,
      open: (state: WorkflowViewState) => setWorkflowView(state),
      close: () => setWorkflowView(null),
    }),
    [workflowView],
  )

  const [overlaySessionId, setOverlaySessionId] = useState(displayedSessionId)
  if (displayedSessionId !== overlaySessionId) {
    setOverlaySessionId(displayedSessionId)
    setWorkflowView(null)
    setSubagentView(null)
    setFullscreenPlan(null)
  }

  return {
    fullscreenPlan,
    setFullscreenPlan,
    planFullscreenCtx,
    subagentView,
    subagentNav,
    workflowView,
    workflowNav,
  }
}

export function ChatOverlayProviders({
  workflowNav,
  subagentNav,
  planFullscreenCtx,
  children,
}: {
  workflowNav: ReturnType<typeof useChatOverlays>['workflowNav']
  subagentNav: ReturnType<typeof useChatOverlays>['subagentNav']
  planFullscreenCtx: ReturnType<typeof useChatOverlays>['planFullscreenCtx']
  children: ReactNode
}) {
  return (
    <WorkflowNavigationContext.Provider value={workflowNav}>
      <SubagentNavigationContext.Provider value={subagentNav}>
        <PlanFullscreenContext.Provider value={planFullscreenCtx}>
          {children}
        </PlanFullscreenContext.Provider>
      </SubagentNavigationContext.Provider>
    </WorkflowNavigationContext.Provider>
  )
}

export function renderActiveChatOverlay({
  workflowView,
  subagentView,
  fullscreenPlan,
  setFullscreenPlan,
  showPlanApprovalPrompt,
  scrollToBottom,
}: {
  workflowView: WorkflowViewState | null
  subagentView: SubagentViewState | null
  fullscreenPlan: FullscreenPlanState | null
  setFullscreenPlan: (next: FullscreenPlanState | null) => void
  showPlanApprovalPrompt: boolean
  scrollToBottom?: () => void
}): ReactNode | null {
  if (workflowView) {
    return (
      <Suspense fallback={null}>
        <WorkflowFullView view={workflowView} />
      </Suspense>
    )
  }
  if (subagentView) {
    return <SubagentFullView view={subagentView} />
  }
  if (fullscreenPlan) {
    return (
      <CodexPlanFullscreenView
        text={fullscreenPlan.text}
        onApprovePlan={fullscreenPlan.onApprovePlan}
        onRejectPlan={fullscreenPlan.onRejectPlan}
        planApproval={fullscreenPlan.planApproval}
        onClose={(reason) => {
          setFullscreenPlan(null)
          if (reason === 'reject') {
            requestAnimationFrame(() => scrollToBottom?.())
          }
        }}
      />
    )
  }
  if (showPlanApprovalPrompt) {
    return <PlanApprovalPrompt />
  }
  return null
}
