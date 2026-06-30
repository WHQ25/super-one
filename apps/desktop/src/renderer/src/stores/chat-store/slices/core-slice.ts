import type { StateCreator } from 'zustand'
import type { ImageAttachment } from '@superone/shared/agent-types'
import type { ChatStore, Mention, SessionWriteTarget } from '../types'
import { commitPerSession, updateActivePerSession, updateProjectState } from '../index'

/**
 * Common per-session UI/state setters that don't drive turn lifecycle.
 * Tiny pure-set callbacks aggregated here so they're not scattered across
 * the useChatStore body.
 */
export interface CoreSlice {
  toggleOpen: () => void
  setCorner: (corner: ChatStore['corner']) => void
  requestChatInputFocusRestore: () => void
  dismissSlashCommandOutput: (target?: SessionWriteTarget) => void
  dismissCompactError: () => void
  openProviderPopup: () => void
  openMcpPopup: () => void
  toggleTodos: () => void
  addAttachment: (attachment: ImageAttachment, target?: SessionWriteTarget) => void
  removeAttachment: (index: number, target?: SessionWriteTarget) => void
  clearAttachments: (target?: SessionWriteTarget) => void
  addMention: (mention: Mention, target?: SessionWriteTarget) => void
  removeMention: (value: string, target?: SessionWriteTarget) => void
  setMiniAppContext: (appId: string, data: { appName: string; summary: string; content: string; mode: 'inject' | 'suggest'; color?: string }, target?: SessionWriteTarget) => void
  clearMiniAppContext: (appId: string, target?: SessionWriteTarget) => void
  toggleMiniAppContext: (appId: string, target?: SessionWriteTarget) => void
  addUserSelection: (text: string, target?: SessionWriteTarget) => void
  removeUserSelectionAt: (index: number, target?: SessionWriteTarget) => void
  clearUserSelections: (target?: SessionWriteTarget) => void
  setShowDirManager: (show: boolean) => void
  setShowReviewPanel: (show: boolean) => void
}

export const createCoreSlice: StateCreator<ChatStore, [], [], CoreSlice> = (set, get) => ({
  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setCorner: (corner) => set({ corner }),

  requestChatInputFocusRestore: () => {
    set((s) => updateActivePerSession(s, (sess) => ({
      chatInputRestoreFocusNonce: sess.chatInputRestoreFocusNonce + 1,
    })))
  },

  dismissSlashCommandOutput: (target) => {
    set((s) => commitPerSession(s, target, () => ({ slashCommandOutput: null })))
  },

  dismissCompactError: () => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s, () => ({ compactError: null })))
  },

  openProviderPopup: () => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s, () => ({
      slashCommandOutput: { command: 'provider', content: '' },
    })))
  },

  openMcpPopup: () => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s, () => ({
      slashCommandOutput: { command: 'mcp', content: '' },
    })))
  },

  toggleTodos: () => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s, (sess) => {
      const willShow = !sess.showTodos
      return { showTodos: willShow, _todosUserDismissed: willShow ? false : true }
    }))
  },

  addAttachment: (attachment, target) => {
    set((s) => commitPerSession(s, target, (sess) => ({
      attachments: [...sess.attachments, attachment],
    })))
  },

  removeAttachment: (index, target) => {
    set((s) => commitPerSession(s, target, (sess) => ({
      attachments: sess.attachments.filter((_, i) => i !== index),
    })))
  },

  clearAttachments: (target) => {
    set((s) => commitPerSession(s, target, () => ({ attachments: [] })))
  },

  addMention: (mention, target) => {
    set((s) => commitPerSession(s, target, (sess) => {
      if (sess.mentions.some((m) => m.value === mention.value)) return {}
      return { mentions: [...sess.mentions, mention] }
    }))
  },

  removeMention: (value, target) => {
    set((s) => commitPerSession(s, target, (sess) => ({
      mentions: sess.mentions.filter((m) => m.value !== value),
    })))
  },

  setMiniAppContext: (appId, data, target) => {
    set((s) => commitPerSession(s, target, (sess) => ({
      miniAppContexts: {
        ...sess.miniAppContexts,
        [appId]: {
          appId,
          appName: data.appName,
          summary: data.summary,
          content: data.content,
          mode: data.mode,
          color: data.color,
          checked: data.mode === 'inject',
        },
      },
    })))
  },

  clearMiniAppContext: (appId, target) => {
    set((s) => commitPerSession(s, target, (sess) => {
      const { [appId]: _, ...rest } = sess.miniAppContexts
      return { miniAppContexts: rest }
    }))
  },

  toggleMiniAppContext: (appId, target) => {
    set((s) => commitPerSession(s, target, (sess) => {
      const slot = sess.miniAppContexts[appId]
      if (!slot) return {}
      return {
        miniAppContexts: {
          ...sess.miniAppContexts,
          [appId]: { ...slot, checked: !slot.checked },
        },
      }
    }))
  },

  addUserSelection: (text, target) => {
    const trimmed = text.trim()
    if (!trimmed) return
    set((s) => commitPerSession(s, target, (sess) => ({
      userSelections: [...sess.userSelections, trimmed],
    })))
  },

  removeUserSelectionAt: (index, target) => {
    set((s) => commitPerSession(s, target, (sess) => ({
      userSelections: sess.userSelections.filter((_, i) => i !== index),
    })))
  },

  clearUserSelections: (target) => {
    set((s) => commitPerSession(s, target, () => ({ userSelections: [] })))
  },

  setShowDirManager: (show) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateProjectState(s, activeProject, () => ({ showDirManager: show })))
  },

  setShowReviewPanel: (show) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateProjectState(s, activeProject, () => ({ showReviewPanel: show })))
  },
})
