import type { StateCreator } from 'zustand'
import type { ContextUsageInfo, RewindFilesResult } from '@superone/shared/agent-types'
import { useActivityViewStateStore } from '../../activity-view-state'
import type { ChatStore, SessionWriteTarget } from '../types'
import { freshSubagentColorPool } from '../defaults'
import {
  _truncateAtCheckpoint,
  cancelPrewarm,
  commitPerSession,
  getScopedPerSession,
  schedulePrewarm,
  updateActivePerSession,
  updatePerSession,
} from '../index'
import { toastSendFailure } from '../helpers/send-error-toast'

/**
 * Per-session actions that touch a specific session's local state but
 * don't drive turn lifecycle (those are in core-slice / event-slice).
 * Covers: rewind family, queued-message ops, draft text, subagent color
 * pool, detailed usage cache, in-memory session eviction.
 */
export interface SessionSlice {
  rewindFiles: (userMessageId: string) => Promise<RewindFilesResult>
  rewindCodeAndChat: (userMessageId: string) => Promise<RewindFilesResult>
  rewindConversation: (userMessageId: string) => Promise<RewindFilesResult>
  previewRewind: (checkpointId: string) => Promise<RewindFilesResult>
  editQueuedMessage: (messageId: string, target?: SessionWriteTarget) => void
  deleteQueuedMessage: (messageId: string, target?: SessionWriteTarget) => void
  steerQueuedMessage: (messageId: string, target?: SessionWriteTarget) => Promise<boolean>
  startQueuedMessages: (target?: SessionWriteTarget) => Promise<boolean>
  setDraftText: (text: string, target?: SessionWriteTarget) => void
  setDraftJson: (json: object | null, target?: SessionWriteTarget) => void
  assignSubagentColor: (toolUseId: string) => void
  setDetailedUsage: (projectPath: string, sessionId: string, usage: ContextUsageInfo | null) => void
  removeSessionFromMemory: (projectPath: string, sessionId: string) => void
}

export const createSessionSlice: StateCreator<ChatStore, [], [], SessionSlice> = (set, get) => ({
  rewindFiles: async (userMessageId: string) => {
    const { activeProject } = get()
    if (!activeProject) throw new Error('No active project')
    const result = await window.agent.rewindFiles(activeProject, userMessageId)
    if (result.canRewind !== false) {
      set((s) => updateActivePerSession(s, (sess) => ({
        messages: sess.messages.map((m) =>
          m.checkpointId === userMessageId ? { ...m, rewound: 'code' as const } : m
        ),
      })))
    }
    return result
  },

  rewindCodeAndChat: async (userMessageId: string) => {
    const { activeProject } = get()
    if (!activeProject) throw new Error('No active project')
    const result = await window.agent.rewindCodeAndChat(activeProject, userMessageId)
    if (result.canRewind !== false) {
      _truncateAtCheckpoint(set, get, activeProject, userMessageId)
    }
    return result
  },

  rewindConversation: async (userMessageId: string) => {
    const { activeProject } = get()
    if (!activeProject) throw new Error('No active project')
    const result = await window.agent.rewindConversation(activeProject, userMessageId)
    if (result.canRewind !== false) {
      _truncateAtCheckpoint(set, get, activeProject, userMessageId)
    }
    return result
  },

  previewRewind: async (checkpointId: string) => {
    const { activeProject } = get()
    if (!activeProject) throw new Error('No active project')
    return window.agent.previewRewind(activeProject, checkpointId)
  },

  editQueuedMessage: async (messageId, target) => {
    const projectPath = target?.projectPath ?? get().activeProject
    if (!projectPath) return
    const session = getScopedPerSession(get(), target)
    const msg = session.queuedMessages.find((m) => m.id === messageId)
    if (!msg) return
    const removed = await window.agent.dequeueMessage(projectPath, messageId)
    if (!removed) return
    const text = msg.content.find((b) => b.type === 'text')
    const attachments = msg.attachments ?? []
    set((s) => commitPerSession(s, target, (sess) => ({
      queuedMessages: sess.queuedMessages.filter((m) => m.id !== messageId),
      draftText: text && 'text' in text ? text.text : '',
      attachments,
      codexPlanRejectHintActive: false,
    })))
  },

  deleteQueuedMessage: async (messageId, target) => {
    const projectPath = target?.projectPath ?? get().activeProject
    if (!projectPath) return
    const removed = await window.agent.dequeueMessage(projectPath, messageId)
    if (!removed) return
    set((s) => commitPerSession(s, target, (sess) => ({
      queuedMessages: sess.queuedMessages.filter((m) => m.id !== messageId),
    })))
  },

  steerQueuedMessage: async (messageId, target) => {
    const projectPath = target?.projectPath ?? get().activeProject
    if (!projectPath) return false
    const session = getScopedPerSession(get(), target)
    if (!session.queuedMessages.some((message) => message.id === messageId)) return false
    try {
      return await window.agent.steerQueuedMessage(projectPath, messageId, target?.sessionId)
    } catch (error) {
      toastSendFailure(error)
      return false
    }
  },

  startQueuedMessages: async (target) => {
    const projectPath = target?.projectPath ?? get().activeProject
    if (!projectPath) return false
    return window.agent.startQueuedMessages(projectPath, target?.sessionId)
  },

  setDraftText: (text, target) => {
    const updates = () => ({
      draftText: text,
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
  },
})
