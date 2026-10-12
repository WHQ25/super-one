import { useMemo } from 'react'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { TurnPlanApproval } from '@superone/chat-view/presenters/TurnBody'
import { useActiveSession, useChatStore } from '@/stores/chat'

/**
 * The latest plan's approval for a turn. Codex owns plan approval (its
 * collaboration mode and `planApproval` metadata); a turn offers the actions
 * when it is the settled last reply in plan mode and nothing else is pending.
 */
export function useTurnPlanApproval(message: ChatMessage, isStreaming: boolean, isLastAssistant: boolean): TurnPlanApproval | undefined {
  const inPlanMode = useActiveSession((state) => state.selectedCodexCollaborationMode === 'plan' && !state.hasPendingInteraction)
  const onApprove = useChatStore((state) => state.approveCodexPlan)
  const onReject = useChatStore((state) => state.rejectCodexPlan)
  const state = message.metadata?.codex?.planApproval
  const canRespond = inPlanMode && !isStreaming && isLastAssistant
  return useMemo(
    () => message.role === 'assistant' ? { state, canRespond, onApprove, onReject } : undefined,
    [message.role, state, canRespond, onApprove, onReject],
  )
}
