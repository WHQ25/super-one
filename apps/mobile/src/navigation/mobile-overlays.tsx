import type { RefObject } from 'react'
import type {
  AskUserQuestionRequest,
  PermissionRequest,
  PlanApprovalRequest,
} from '@superone/shared/agent-types'
import type { ChatRuntime } from '../runtime'
import { PermissionSheet, PlanSheet, QuestionSheet } from '../sheets'
import { SharedFileSheet, type useSharedFileInbox } from '../shared-file-inbox'
import { runUiAction } from '../ui-action'
import { WorkspaceDrawer, type WorkspaceDrawerProps } from './workspace-drawer'

export function MobileOverlays(props: {
  runtimeRef: RefObject<ChatRuntime | null>
  setStatus: (status: string) => void
  permission: PermissionRequest | null
  plan: PlanApprovalRequest | null
  question: AskUserQuestionRequest | null
  planContinueMode?: string
  onPlanContinueMode: (mode: string) => void
  workspace: WorkspaceDrawerProps
  sharedFileInbox: ReturnType<typeof useSharedFileInbox>
}) {
  const runtime = () => props.runtimeRef.current
  return (
    <>
      <PermissionSheet
        perm={props.permission}
        loadSystemInfo={async (harness) => {
          const active = runtime()
          if (!active) throw new Error("No active connection")
          return active.loadSystemInfo(harness)
        }}
        onAllow={(id, formAnswers, alwaysAllow, selectedSuggestions) => runUiAction(
          () => runtime()?.respondPermission(id, true, formAnswers, alwaysAllow, undefined, selectedSuggestions),
          props.setStatus,
          'permission response failed',
        )}
        onDeny={(id, reason) => runUiAction(
          () => runtime()?.respondPermission(id, false, undefined, undefined, reason),
          props.setStatus,
          'permission response failed',
        )}
      />
      <PlanSheet
        plan={props.plan}
        continueMode={props.planContinueMode}
        onApprove={(id) => runUiAction(
          () => runtime()?.respondPlan(id, true),
          props.setStatus,
          'plan response failed',
        )}
        onApproveAndContinue={(id, mode) => runUiAction(() => {
          runtime()?.respondPlan(id, true)
          runtime()?.setPermissionMode(mode)
          props.onPlanContinueMode(mode)
        }, props.setStatus, 'plan response failed')}
        onReject={(id, feedback) => runUiAction(
          () => runtime()?.respondPlan(id, false, feedback),
          props.setStatus,
          'plan response failed',
        )}
      />
      <QuestionSheet
        question={props.question}
        onSubmit={(id, answers, annotations) => runUiAction(
          () => runtime()?.answerQuestion(id, answers, annotations),
          props.setStatus,
          'question response failed',
        )}
        onDismiss={(id) => runUiAction(
          () => runtime()?.dismissQuestion(id),
          props.setStatus,
          'question response failed',
        )}
      />
      <WorkspaceDrawer {...props.workspace} />
      <SharedFileSheet inbox={props.sharedFileInbox} />
    </>
  )
}
