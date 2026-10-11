import {
  createLocalTextUserMessage,
  getCodexPlanActionContext,
  updateCodexPlanApproval,
} from '../helpers/codex-helpers'
import { ChatStoreSet } from '../helpers/lifecycle'
import { isRemoteSession } from '../index'
import { commitPerSession } from '../helpers/store-helpers'
import { createSendWriteScope } from '../helpers/send-write-scope'
import { deliverSessionTurn, sessionTurnRequest } from '../helpers/session-turn'
import type { ChatStore, PerSessionState } from '../types'
import { respondPlan } from '@/lib/session-client'
import { newMessageId } from '@superone/shared/message-id'

const CODEX_APPROVE_PLAN_PROMPT = 'Plan approved, start implementation.'

type PlanContext = NonNullable<ReturnType<typeof getCodexPlanActionContext>>

/** The host records the verdict on the plan message itself. */
function sendVerdict(projectPath: string, context: PlanContext, decision: 'approve' | 'reject', feedback?: string): Promise<void> {
  return respondPlan(projectPath, {
    sessionId: context.codexSessionId,
    interactionId: context.assistantMessageId,
    decision,
    options: { messageId: context.assistantMessageId, ...(feedback ? { feedback } : {}) },
  }).catch((error) => console.warn('[chat] plan verdict failed:', error))
}

/** Record the verdict on the plan message, then send `text` as a turn in the session's (updated) collaboration mode. */
async function answerPlan(
  set: ChatStoreSet,
  get: () => ChatStore,
  projectPath: string,
  context: PlanContext,
  decision: 'approve' | 'reject',
  text: string,
  patch: (session: PerSessionState) => Partial<PerSessionState>,
): Promise<void> {
  const owner = { projectPath, sessionId: context.codexSessionId }
  const messageId = newMessageId('user')
  set((s) => ({
    ...commitPerSession(s, owner, (sess) => {
      const next = { ...sess, ...patch(sess) }
      return { ...next, additionalDirsDirty: false, awaitingAssistantReply: true, messages: [...next.messages, createLocalTextUserMessage(messageId, text)] }
    }),
    isOpen: true,
  }))
  await sendVerdict(projectPath, context, decision, decision === 'reject' ? text : undefined)
  await deliverSessionTurn(set, createSendWriteScope(set, get, projectPath, owner), {
    projectPath,
    request: {
      ...sessionTurnRequest(get(), projectPath, context.codexSessionId, { text, clientMessageId: messageId, userMessageContent: [{ type: 'text', text }] }),
      clientMessageId: messageId,
    },
    titleText: text,
    retryState: () => ({ awaitingAssistantReply: true }),
  })
}

export async function approveCodexPlanImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
): Promise<void> {
  const { activeProject } = get()
  if (!activeProject) return
  if (isRemoteSession(get(), activeProject, get().projectSessions[activeProject]?._activeSessionId)) return

  const context = getCodexPlanActionContext(get, activeProject)
  if (!context) return

  await answerPlan(set, get, activeProject, context, 'approve', CODEX_APPROVE_PLAN_PROMPT, (sess) => ({
    ...updateCodexPlanApproval(sess, context.assistantMessageId, { status: 'approved' }),
    selectedCodexCollaborationMode: 'default',
    codexPlanRejectHintActive: false,
  }))
}

export async function rejectCodexPlanImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  feedback: string | undefined,
): Promise<void> {
  const { activeProject } = get()
  if (!activeProject) return
  if (isRemoteSession(get(), activeProject, get().projectSessions[activeProject]?._activeSessionId)) return

  const context = getCodexPlanActionContext(get, activeProject)
  if (!context) return

  const trimmedFeedback = feedback?.trim()
  if (!trimmedFeedback) {
    set((s) => ({
      ...commitPerSession(s, { projectPath: activeProject, sessionId: context.codexSessionId }, (sess) => ({
        ...updateCodexPlanApproval(sess, context.assistantMessageId, { status: 'rejected' }),
        codexPlanRejectHintActive: true,
        chatInputFocusNonce: sess.chatInputFocusNonce + 1,
      })),
      isOpen: true,
    }))
    await sendVerdict(activeProject, context, 'reject')
    return
  }

  await answerPlan(set, get, activeProject, context, 'reject', trimmedFeedback, (sess) => ({
    ...updateCodexPlanApproval(sess, context.assistantMessageId, { status: 'rejected', feedback: trimmedFeedback }),
    codexPlanRejectHintActive: false,
  }))
}
