import {
  createLocalTextUserMessage,
  getCodexPlanActionContext,
  updateCodexPlanApproval,
} from '../helpers/codex-helpers'
import { ChatStoreSet } from '../helpers/lifecycle'
import { isRemoteSession } from '../index'
import { updateActivePerSession } from '../helpers/store-helpers'
import type { ChatStore } from '../types'
import { runCodexCommand } from './runner'
import { newMessageId } from '@superone/shared/message-id'

const CODEX_APPROVE_PLAN_PROMPT = 'Plan approved, start implementation.'

export async function approveCodexPlanImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
): Promise<void> {
  const { activeProject } = get()
  if (!activeProject) return
  if (isRemoteSession(get(), activeProject, get().projectSessions[activeProject]?._activeSessionId)) return

  const context = getCodexPlanActionContext(get, activeProject)
  if (!context) return

  const userMessageId = newMessageId('user')
  const userMessage = createLocalTextUserMessage(userMessageId, CODEX_APPROVE_PLAN_PROMPT)

  set((s) => ({
    ...updateActivePerSession(s, (sess) => {
      const approvedSession = updateCodexPlanApproval(sess, context.assistantMessageId, { status: 'approved' })
      return {
        ...approvedSession,
        selectedCodexCollaborationMode: 'default',
        codexPlanRejectHintActive: false,
        additionalDirsDirty: false,
        messages: [...(approvedSession.messages ?? sess.messages), userMessage],
      }
    }),
    isOpen: true,
  }))

  window.app.codexPlanApproval(activeProject, context.codexSessionId, context.assistantMessageId, 'approved')
  window.app.codexCollaborationModeChange(activeProject, context.codexSessionId, 'default')

  await runCodexCommand(set, get, {
    activeProject,
    codexSessionId: context.codexSessionId,
    session: context.session,
    codexCommand: { kind: 'run', prompt: CODEX_APPROVE_PLAN_PROMPT },
    finalContent: CODEX_APPROVE_PLAN_PROMPT,
    userMessageId,
    attachments: [],
    selectedCodexPermissionPreset: context.session.selectedCodexPermissionPreset,
    collaborationMode: 'default',
    resolvedCodexModel: context.resolvedCodexModel,
    resolvedCodexReasoningEffort: context.resolvedCodexReasoningEffort,
  })
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
      ...updateActivePerSession(s, (sess) => ({
        ...updateCodexPlanApproval(sess, context.assistantMessageId, { status: 'rejected' }),
        codexPlanRejectHintActive: true,
        chatInputFocusNonce: sess.chatInputFocusNonce + 1,
      })),
      isOpen: true,
    }))
    window.app.codexPlanApproval(activeProject, context.codexSessionId, context.assistantMessageId, 'rejected')
    return
  }

  const userMessageId = newMessageId('user')
  const userMessage = createLocalTextUserMessage(userMessageId, trimmedFeedback)

  set((s) => ({
    ...updateActivePerSession(s, (sess) => {
      const rejectedSession = updateCodexPlanApproval(
        sess,
        context.assistantMessageId,
        { status: 'rejected', feedback: trimmedFeedback },
      )
      return {
        ...rejectedSession,
        codexPlanRejectHintActive: false,
        additionalDirsDirty: false,
        messages: [...(rejectedSession.messages ?? sess.messages), userMessage],
      }
    }),
    isOpen: true,
  }))

  window.app.codexPlanApproval(activeProject, context.codexSessionId, context.assistantMessageId, 'rejected', trimmedFeedback)

  await runCodexCommand(set, get, {
    activeProject,
    codexSessionId: context.codexSessionId,
    session: context.session,
    codexCommand: { kind: 'run', prompt: trimmedFeedback },
    finalContent: trimmedFeedback,
    userMessageId,
    attachments: [],
    selectedCodexPermissionPreset: context.session.selectedCodexPermissionPreset,
    collaborationMode: 'plan',
    resolvedCodexModel: context.resolvedCodexModel,
    resolvedCodexReasoningEffort: context.resolvedCodexReasoningEffort,
  })
}
