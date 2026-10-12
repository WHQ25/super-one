import type { TurnPlanPresenterProps } from '@superone/chat-view/presenters/TurnBody'
import { CopyableMarkdown } from './CopyableMarkdown'
import { CodexPlanImplementFooter } from './CodexPlanImplementFooter'
import { CodexPlanBlockPresenter } from './presenters/CodexPlanBlock'
import { fileLinkComponents } from './chat-markdown-components'
import { usePlanFullscreen } from './plan-fullscreen-context'

function PlanMarkdown({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  return <CopyableMarkdown text={text} isStreaming={isStreaming} components={fileLinkComponents} />
}

/** A proposed plan in a desktop turn; the latest one carries its approval actions. */
export function PlanBlock({ id, text, isStreaming, hasFollowingBlock, approval }: TurnPlanPresenterProps) {
  const planFullscreen = usePlanFullscreen()
  const respond = approval?.canRespond && !approval.state
  return (
    <CodexPlanBlockPresenter
      item={{ id, type: 'plan', text }}
      isStreaming={isStreaming}
      hasFollowingItem={hasFollowingBlock}
      planApproval={approval?.state}
      onApprovePlan={respond ? approval.onApprove : undefined}
      onRejectPlan={respond ? approval.onReject : undefined}
      onOpenFullscreen={(planText, actions) => planFullscreen.open(planText, actions)}
      renderApprovalActions={({ onApprove, onReject }) => <CodexPlanImplementFooter onApprove={onApprove} onReject={onReject} />}
      Markdown={PlanMarkdown}
    />
  )
}
