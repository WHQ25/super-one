import type { RefObject } from 'react'
import type {
  AskUserQuestionRequest,
  PermissionRequest,
  PlanApprovalRequest,
} from '@superone/shared/agent-types'
import type { MediaPorts } from '../media-ports'
import type { ChatRuntime } from '../runtime'
import { PermissionSheet, PlanSheet, QuestionSheet } from '../sheets'
import { runUiAction } from '../ui-action'
import { FilePreviewModal } from '../ui/file-preview'
import type { useFilePreview } from './use-file-preview'
import { WorkspaceDrawer, type WorkspaceDrawerProps } from './workspace-drawer'

export function MobileOverlays(props: {
  runtimeRef: RefObject<ChatRuntime | null>
  setStatus: (status: string) => void
  permission: PermissionRequest | null
  plan: PlanApprovalRequest | null
  question: AskUserQuestionRequest | null
  planContinueMode?: string
  onPlanContinueMode: (mode: string) => void
  /** Request ids put away behind a strip; an outside tap on a sheet adds one. */
  collapsedPrompts: ReadonlySet<string>
  onCollapsePrompt: (requestId: string) => void
  workspace: WorkspaceDrawerProps
  /** The fullscreen preview every picture and file opens into. */
  filePreview: ReturnType<typeof useFilePreview>
  mediaPorts: MediaPorts
}) {
  const runtime = () => props.runtimeRef.current
  return (
    <>
      <PermissionSheet
        perm={props.permission}
        collapsed={!!props.permission && props.collapsedPrompts.has(props.permission.requestId)}
        onCollapse={props.onCollapsePrompt}
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
        collapsed={!!props.plan && props.collapsedPrompts.has(props.plan.requestId)}
        onCollapse={props.onCollapsePrompt}
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
        collapsed={!!props.question && props.collapsedPrompts.has(props.question.requestId)}
        onCollapse={props.onCollapsePrompt}
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
      <FilePreviewModal
        state={props.filePreview.state}
        ports={props.mediaPorts}
        onDismiss={props.filePreview.close}
        onStartTransfer={props.filePreview.startTransfer}
        onRetry={props.filePreview.retry}
        generationPorts={props.filePreview.generationPorts}
      />
    </>
  )
}
