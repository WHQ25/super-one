import type { RefObject } from 'react'
import type {
  PermissionRequest,
  PlanApprovalRequest,
} from '@superone/shared/agent-types'
import type { MarkdownDocumentPorts } from '../markdown-document-requests'
import type { MediaPorts } from '../media-ports'
import type { ChatRuntime } from '../runtime'
import { PermissionSheet, PlanSheet } from '../sheets'
import { runUiAction } from '../ui-action'
import { FilePreviewModal } from '../ui/file-preview'
import type { useFilePreview } from './use-file-preview'
import { WorkspaceDrawer, type WorkspaceDrawerProps } from './workspace-drawer'
import { DesktopUpgradeSheet, type DesktopUpgradeSheetProps } from '../screens/desktop-upgrade-sheet'

export function MobileOverlays(props: {
  runtimeRef: RefObject<ChatRuntime | null>
  setStatus: (status: string) => void
  permission: PermissionRequest | null
  plan: PlanApprovalRequest | null
  planContinueMode?: string
  onPlanContinueMode: (mode: string) => void
  /** Request ids put away behind a strip; an outside tap on a sheet adds one. */
  collapsedPrompts: ReadonlySet<string>
  onCollapsePrompt: (requestId: string) => void
  workspace: WorkspaceDrawerProps
  /** The fullscreen preview every picture and file opens into. */
  filePreview: ReturnType<typeof useFilePreview>
  mediaPorts: MediaPorts
  documentPorts: MarkdownDocumentPorts
  desktopUpgrade: DesktopUpgradeSheetProps
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
        onApproveAndContinue={(id, mode) => runUiAction(async () => {
          await runtime()?.respondPlan(id, true)
          runtime()?.setPermissionMode(mode)
          props.onPlanContinueMode(mode)
        }, props.setStatus, 'plan response failed')}
        onReject={(id, feedback) => runUiAction(
          () => runtime()?.respondPlan(id, false, feedback),
          props.setStatus,
          'plan response failed',
        )}
      />
      <WorkspaceDrawer {...props.workspace} />
      <FilePreviewModal
        state={props.filePreview.state}
        covered={props.filePreview.covered}
        ports={props.mediaPorts}
        onDismiss={props.filePreview.back}
        onStartTransfer={props.filePreview.startTransfer}
        onRetry={props.filePreview.retry}
        generationPorts={props.filePreview.generationPorts}
        documentPorts={props.documentPorts}
      />
      <DesktopUpgradeSheet {...props.desktopUpgrade} />
    </>
  )
}
