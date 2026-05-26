import type { StateCreator } from 'zustand'
import type { ImageAttachment } from '@superone/shared/agent-types'
import type { ChatStore, Mention } from '../types'
import { updateActivePerSession, updateProjectState } from '../index'

/**
 * Common per-session UI/state setters that don't drive turn lifecycle.
 * Tiny pure-set callbacks aggregated here so they're not scattered across
 * the useChatStore body.
 */
export interface CoreSlice {
  toggleOpen: () => void
  setCorner: (corner: ChatStore['corner']) => void
  requestChatInputFocusRestore: () => void
  dismissSlashCommandOutput: () => void
  openProviderPopup: () => void
  openMcpPopup: () => void
  toggleTodos: () => void
  addAttachment: (attachment: ImageAttachment) => void
  removeAttachment: (index: number) => void
  clearAttachments: () => void
  addMention: (mention: Mention) => void
  removeMention: (value: string) => void
  setMiniAppContext: (appId: string, data: { appName: string; summary: string; content: string; mode: 'inject' | 'suggest'; color?: string }) => void
  clearMiniAppContext: (appId: string) => void
  toggleMiniAppContext: (appId: string) => void
  addUserSelection: (text: string) => void
  removeUserSelectionAt: (index: number) => void
  clearUserSelections: () => void
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

  dismissSlashCommandOutput: () => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s, () => ({ slashCommandOutput: null })))
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

  addAttachment: (attachment) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s, (sess) => ({
      attachments: [...sess.attachments, attachment],
    })))
  },

  removeAttachment: (index) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s, (sess) => ({
      attachments: sess.attachments.filter((_, i) => i !== index),
    })))
  },

  clearAttachments: () => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s, () => ({ attachments: [] })))
  },

  addMention: (mention) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s, (sess) => {
      if (sess.mentions.some((m) => m.value === mention.value)) return {}
      return { mentions: [...sess.mentions, mention] }
    }))
  },

  removeMention: (value) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s, (sess) => ({
      mentions: sess.mentions.filter((m) => m.value !== value),
    })))
  },

  setMiniAppContext: (appId, data) => {
    if (!get().activeProject) return
    set((s) => updateActivePerSession(s, (sess) => ({
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

  clearMiniAppContext: (appId) => {
    if (!get().activeProject) return
    set((s) => updateActivePerSession(s, (sess) => {
      const { [appId]: _, ...rest } = sess.miniAppContexts
      return { miniAppContexts: rest }
    }))
  },

  toggleMiniAppContext: (appId) => {
    if (!get().activeProject) return
    set((s) => updateActivePerSession(s, (sess) => {
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

  addUserSelection: (text) => {
    if (!get().activeProject) return
    const trimmed = text.trim()
    if (!trimmed) return
    set((s) => updateActivePerSession(s, (sess) => ({
      userSelections: [...sess.userSelections, trimmed],
    })))
  },

  removeUserSelectionAt: (index) => {
    if (!get().activeProject) return
    set((s) => updateActivePerSession(s, (sess) => ({
      userSelections: sess.userSelections.filter((_, i) => i !== index),
    })))
  },

  clearUserSelections: () => {
    if (!get().activeProject) return
    set((s) => updateActivePerSession(s, () => ({ userSelections: [] })))
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
