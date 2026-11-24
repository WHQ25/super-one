import { create } from 'zustand'
import type { BrowserDownloadItem } from '@superone/shared/agent-types'

interface BrowserDownloadsStore {
  items: BrowserDownloadItem[]
  loaded: boolean
  hasUnseenCompletion: boolean
  load: () => Promise<void>
  upsert: (item: BrowserDownloadItem) => void
  markSeen: () => void
  cancel: (id: string) => Promise<void>
  open: (path: string) => Promise<void>
  showInFolder: (path: string) => Promise<void>
  clear: (id?: string) => Promise<void>
}

export const useBrowserDownloadsStore = create<BrowserDownloadsStore>((set, get) => ({
  items: [],
  loaded: false,
  hasUnseenCompletion: false,
  load: async () => {
    const items = await window.app.browserDownloadList()
    set({ items, loaded: true })
  },
  upsert: (item) => {
    const prev = get().items
    const index = prev.findIndex((entry) => entry.id === item.id)
    const previous = index >= 0 ? prev[index] : null
    const next = index >= 0
      ? prev.map((entry, idx) => (idx === index ? item : entry))
      : [item, ...prev]
    const justCompleted = previous?.state === 'progressing' && item.state === 'completed'
    set({
      items: next,
      loaded: true,
      hasUnseenCompletion: justCompleted ? true : get().hasUnseenCompletion,
    })
  },
  markSeen: () => {
    if (get().hasUnseenCompletion) set({ hasUnseenCompletion: false })
  },
  cancel: async (id) => {
    await window.app.browserDownloadCancel(id)
  },
  open: async (filePath) => {
    await window.app.browserDownloadOpen(filePath)
  },
  showInFolder: async (filePath) => {
    await window.app.browserDownloadShowInFolder(filePath)
  },
  clear: async (id) => {
    const items = await window.app.browserDownloadClear(id)
    set({ items, hasUnseenCompletion: false })
  },
}))
