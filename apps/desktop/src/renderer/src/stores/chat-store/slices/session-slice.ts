import type { StateCreator } from 'zustand'
import type { ContextUsageInfo, RewindFilesResult } from '@superone/shared/agent-types'
import { useActivityViewStateStore } from '../../activity-view-state'
import type { ChatStore } from '../types'
import { freshSubagentColorPool } from '../defaults'
import {
  _truncateAtCheckpoint,
  getActivePerSession,
  schedulePrewarmKeepalive,
  updateActivePerSession,
  updatePerSession,
} from '../index'

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
  editQueuedMessage: (messageId: string) => void
  deleteQueuedMessage: (messageId: string) => void
  setDraftText: (text: string) => void
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
    const result = await window.agent.rewindConversation(activeProject)
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

  editQueuedMessage: async (messageId) => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getActivePerSession(get())
    const msg = session.queuedMessages.find((m) => m.id === messageId)
    if (!msg) return
    const removed = await window.agent.dequeueMessage(activeProject, messageId)
    if (!removed) return
    const text = msg.content.find((b) => b.type === 'text')
    const attachments = msg.attachments ?? []
    set((s) => updateActivePerSession(s, (sess) => ({
      queuedMessages: sess.queuedMessages.filter((m) => m.id !== messageId),
      draftText: text && 'text' in text ? text.text : '',
      attachments,
      codexPlanRejectHintActive: false,
    })))
  },

  deleteQueuedMessage: async (messageId) => {
    const { activeProject } = get()
    if (!activeProject) return
    const removed = await window.agent.dequeueMessage(activeProject, messageId)
    if (!removed) return
    set((s) => updateActivePerSession(s, (sess) => ({
      queuedMessages: sess.queuedMessages.filter((m) => m.id !== messageId),
    })))
  },

  setDraftText: (text) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s, () => ({
      draftText: text,
      ...(text.length > 0 ? { codexPlanRejectHintActive: false } : {}),
    })))
    if (text.length > 0) {
      schedulePrewarmKeepalive(get(), activeProject)
    }
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
