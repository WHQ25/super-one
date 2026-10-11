import type { StateCreator } from 'zustand'
import type { ChatMessage, ClaudeSteerPriority, ContextUsageInfo, RewindFilesResult } from '@superone/shared/agent-types'
import { useActivityViewStateStore } from '../../activity-view-state'
import { disposeModUiClient } from '@/lib/mod-ui/registry'
import type { ChatStore, PerSessionState, SessionWriteTarget, SetDraftTextOptions } from '../types'
import { freshSubagentColorPool } from '../defaults'
import {
  _truncateAtCheckpoint,
  cancelPrewarm,
  commitPerSession,
  getScopedPerSession,
  resolveWriteScope,
  schedulePrewarm,
  updateActivePerSession,
  updatePerSession,
} from '../index'
import { toastSendFailure } from '../helpers/send-error-toast'
import { deliverUserSend, dropSendReplay, replayFailedSend } from '../helpers/send-replay'
import { createSendWriteScope } from '../helpers/send-write-scope'
import { resendSessionMessage } from '../helpers/session-turn'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { callSession } from '@/lib/session-client'
import { failedMessageResend, withoutSendFailure } from '@superone/chat-core'
import { isDuplicateSend } from '@superone/shared/send-failure'
import { restoreSentDraft } from '@/components/chat/chat-input/restore-sent-draft'
import { messageDraft } from '@/components/chat/chat-input/message-draft'

/** Take a queued message back from its host; false once the host has started it. */
async function dequeue(state: ChatStore, messageId: string, target?: SessionWriteTarget): Promise<boolean> {
  const { projectPath, sessionId } = resolveWriteScope(state, target)
  if (!projectPath || !sessionId) return false
  try {
    return (await callSession(projectPath, sessionId, 'session.dequeue', { clientMessageId: messageId })).removed
  } catch (error) {
    console.warn('[chat] dequeue failed:', error)
    return false
  }
}

/** Put a user message the host never ran back into the composer, after anything typed since. */
function composerDraftFrom(current: PerSessionState, msg: ChatMessage): Partial<PerSessionState> {
  return {
    ...restoreSentDraft(current, messageDraft(msg)),
    codexPlanRejectHintActive: false,
  }
}

/**
 * Per-session actions that touch a specific session's local state but
 * don't drive turn lifecycle (those are in core-slice / event-slice).
 * Covers: rewind family, queued-message ops, draft text, subagent color
 * pool, detailed usage cache, in-memory session eviction.
 */
export interface SessionSlice {
  rewindFiles: (userMessageId: string, target?: SessionWriteTarget) => Promise<RewindFilesResult>
  rewindCodeAndChat: (userMessageId: string, target?: SessionWriteTarget) => Promise<RewindFilesResult>
  rewindConversation: (userMessageId: string, target?: SessionWriteTarget) => Promise<RewindFilesResult>
  previewRewind: (checkpointId: string, target?: SessionWriteTarget) => Promise<RewindFilesResult>
  editQueuedMessage: (messageId: string, target?: SessionWriteTarget) => void
  /**
   * Resend a failed user message exactly as it originally went out, or — when
   * that send is no longer held (a reload; a failure the host recorded) — from
   * the transcript row, under the same id.
   */
  resendFailedMessage: (messageId: string, target?: SessionWriteTarget) => Promise<void>
  /** Drop a failed user message from the transcript and put it back into the composer. */
  editFailedMessage: (messageId: string, target?: SessionWriteTarget) => void
  deleteQueuedMessage: (messageId: string, target?: SessionWriteTarget) => void
  steerQueuedMessage: (messageId: string, target?: SessionWriteTarget, priority?: ClaudeSteerPriority) => Promise<boolean>
  startQueuedMessages: (target?: SessionWriteTarget) => Promise<boolean>
  setDraftText: (text: string, target?: SessionWriteTarget, opts?: SetDraftTextOptions) => void
  setDraftJson: (json: object | null, target?: SessionWriteTarget) => void
  assignSubagentColor: (toolUseId: string) => void
  setDetailedUsage: (projectPath: string, sessionId: string, usage: ContextUsageInfo | null) => void
  removeSessionFromMemory: (projectPath: string, sessionId: string) => void
}

export const createSessionSlice: StateCreator<ChatStore, [], [], SessionSlice> = (set, get) => ({
  rewindFiles: async (userMessageId: string, target?: SessionWriteTarget) => {
    const { projectPath: activeProject, sessionId } = resolveWriteScope(get(), target)
    if (!activeProject || !sessionId) throw new Error('No active project')
    const result = await callSession(activeProject, sessionId, 'session.rewind', { checkpointId: userMessageId, mode: 'files' })
    if (result.canRewind !== false) {
      set((s) => commitPerSession(s, { projectPath: activeProject, sessionId }, (sess) => ({
        messages: sess.messages.map((m) =>
          m.checkpointId === userMessageId ? { ...m, rewound: 'code' as const } : m
        ),
      })))
    }
    return result
  },

  rewindCodeAndChat: async (userMessageId: string, target?: SessionWriteTarget) => {
    const { projectPath: activeProject, sessionId } = resolveWriteScope(get(), target)
    if (!activeProject || !sessionId) throw new Error('No active project')
    const result = await callSession(activeProject, sessionId, 'session.rewind', { checkpointId: userMessageId, mode: 'code+chat' })
    if (result.canRewind !== false) {
      _truncateAtCheckpoint(set, get, activeProject, userMessageId, sessionId)
    }
    return result
  },

  rewindConversation: async (userMessageId: string, target?: SessionWriteTarget) => {
    const { projectPath: activeProject, sessionId } = resolveWriteScope(get(), target)
    if (!activeProject || !sessionId) throw new Error('No active project')
    const result = await callSession(activeProject, sessionId, 'session.rewind', { checkpointId: userMessageId, mode: 'conversation' })
    if (result.canRewind !== false) {
      _truncateAtCheckpoint(set, get, activeProject, userMessageId, sessionId)
    }
    return result
  },

  previewRewind: async (checkpointId: string, target?: SessionWriteTarget) => {
    const { projectPath: activeProject, sessionId } = resolveWriteScope(get(), target)
    if (!activeProject || !sessionId) throw new Error('No active project')
    return callSession(activeProject, sessionId, 'session.previewRewind', { checkpointId })
  },

  editQueuedMessage: async (messageId, target) => {
    const msg = getScopedPerSession(get(), target).queuedMessages.find((m) => m.id === messageId)
    if (!msg) return
    if (!await dequeue(get(), messageId, target)) return
    set((s) => commitPerSession(s, target, (sess) => ({
      queuedMessages: sess.queuedMessages.filter((m) => m.id !== messageId),
      ...composerDraftFrom(sess, msg),
    })))
  },

  resendFailedMessage: async (messageId, target) => {
    if (await replayFailedSend(messageId)) return
    const projectPath = target?.projectPath ?? get().activeProject
    const msg = getScopedPerSession(get(), target).messages.find((m) => m.id === messageId)
    const resend = msg ? failedMessageResend(msg) : null
    if (!projectPath || !resend) return
    await resendSessionMessage(set, get, projectPath, createSendWriteScope(set, get, projectPath, target), resend)
  },

  editFailedMessage: (messageId, target) => {
    const msg = getScopedPerSession(get(), target).messages.find((m) => m.id === messageId)
    if (!msg?.metadata?.sendFailure) return
    dropSendReplay(messageId)
    set((s) => commitPerSession(s, target, (sess) => ({
      messages: sess.messages.filter((m) => m.id !== messageId),
      ...composerDraftFrom(sess, msg),
    })))
  },

  deleteQueuedMessage: async (messageId, target) => {
    if (!await dequeue(get(), messageId, target)) return
    set((s) => commitPerSession(s, target, (sess) => ({
      queuedMessages: sess.queuedMessages.filter((m) => m.id !== messageId),
    })))
  },

  steerQueuedMessage: async (messageId, target, priority) => {
    const { projectPath, sessionId, session } = resolveWriteScope(get(), target)
    if (!projectPath || !sessionId) return false
    if (!session.queuedMessages.some((message) => message.id === messageId)) return false
    try {
      return (await callSession(projectPath, sessionId, 'session.steer', { clientMessageId: messageId, priority: priority ?? 'now' })).ok
    } catch (error) {
      toastSendFailure(error)
      return false
    }
  },

  startQueuedMessages: async (target) => {
    const { projectPath, sessionId } = resolveWriteScope(get(), target)
    if (!projectPath || !sessionId) return false
    return callSession(projectPath, sessionId, 'session.startQueued', {})
  },

  setDraftText: (text, target, opts) => {
    const updates = () => ({
      draftText: text,
      // A plain-text write invalidates the doc snapshot — restoring the composer
      // from a doc that no longer matches the text would paint over this write.
      // The editor's own echo keeps it: its `onUpdate` writes the fresh JSON in
      // the same batch, so nulling here would only cost a needless rebuild.
      ...(opts?.keepDoc ? {} : { draftJson: null }),
      ...(text.length > 0 ? { codexPlanRejectHintActive: false } : {}),
    })
    if (target) {
      set((s) => updatePerSession(s, target.projectPath, target.sessionId, updates))
      if (text.length > 0) schedulePrewarm(get, target.projectPath)
      else cancelPrewarm(target.projectPath)
      return
    }
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s, updates))
    if (text.length > 0) schedulePrewarm(get, activeProject)
    else cancelPrewarm(activeProject)
  },

  setDraftJson: (json, target) => {
    const updates = () => ({ draftJson: json })
    if (target) {
      set((s) => updatePerSession(s, target.projectPath, target.sessionId, updates))
      return
    }
    set((s) => updateActivePerSession(s, updates))
  },

  assignSubagentColor: (toolUseId) => {
    set((s) => updateActivePerSession(s, (sess) => {
      if (sess.subagentColors[toolUseId] !== undefined) return {}
      const free = sess._subagentColorsFree.length > 0 ? sess._subagentColorsFree : freshSubagentColorPool()
      const pickIdx = Math.floor(Math.random() * free.length)
      const color = free[pickIdx]
      const newFree = [...free.slice(0, pickIdx), ...free.slice(pickIdx + 1)]
      return {
        subagentColors: { ...sess.subagentColors, [toolUseId]: color },
        _subagentColorsFree: newFree,
      }
    }))
  },

  setDetailedUsage: (projectPath, sessionId, usage) => {
    set((s) => {
      const project = s.projectSessions[projectPath]
      if (!project?._sessions[sessionId]) return {}
      return updatePerSession(s, projectPath, sessionId, () => ({ detailedUsage: usage }))
    })
  },

  removeSessionFromMemory: (projectPath: string, sessionId: string) => {
    const state = get()
    const proj = state.projectSessions[projectPath]
    if (!proj?._sessions[sessionId]) return
    const { [sessionId]: _, ...rest } = proj._sessions
    set({
      projectSessions: {
        ...state.projectSessions,
        [projectPath]: { ...proj, _sessions: rest },
      },
    })
    useActivityViewStateStore.getState().clearForSession(sessionId)
    disposeModUiClient(sessionId)
  },
})
