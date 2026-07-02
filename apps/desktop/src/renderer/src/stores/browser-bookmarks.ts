import { create } from 'zustand'
import type { BrowserBookmark, BrowserBookmarkGroup } from '@superone/shared/agent-types'

function move<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

interface BrowserBookmarksStore {
  bookmarks: BrowserBookmark[]
  groups: BrowserBookmarkGroup[]
  loaded: boolean
  load: () => Promise<void>
  addBookmark: (input: { url: string; title: string; favicon?: string | null; groupId?: string | null }) => BrowserBookmark
  updateBookmark: (id: string, patch: Partial<Pick<BrowserBookmark, 'title' | 'url' | 'groupId' | 'favicon'>>) => void
  moveBookmarkToGroup: (id: string, groupId: string | null) => void
  moveBookmark: (activeId: string, groupId: string | null, overId: string | null, side?: 'before' | 'after') => void
  reorderGroups: (activeId: string, overId: string) => void
  removeBookmark: (id: string) => void
  removeByUrl: (url: string) => void
  addGroup: (name: string) => BrowserBookmarkGroup
  renameGroup: (id: string, name: string) => void
  removeGroup: (id: string) => void
}

function persist(bookmarks: BrowserBookmark[], groups: BrowserBookmarkGroup[]): void {
  void window.app.saveAppSettings({ browserBookmarks: bookmarks, browserBookmarkGroups: groups })
}

let subscribed = false

export const useBrowserBookmarksStore = create<BrowserBookmarksStore>((set, get) => ({
  bookmarks: [],
  groups: [],
  loaded: false,
  load: async () => {
    const settings = await window.app.getAppSettings()
    set({ bookmarks: settings.browserBookmarks, groups: settings.browserBookmarkGroups, loaded: true })
    if (!subscribed) {
      subscribed = true
      window.app.onAppSettingsChange((next) => {
        set({ bookmarks: next.browserBookmarks, groups: next.browserBookmarkGroups })
      })
    }
  },
  addBookmark: ({ url, title, favicon = null, groupId = null }) => {
    const bookmark: BrowserBookmark = { id: crypto.randomUUID(), url, title, favicon, groupId, createdAt: Date.now() }
    const bookmarks = [...get().bookmarks, bookmark]
    set({ bookmarks })
    persist(bookmarks, get().groups)
    return bookmark
  },
  updateBookmark: (id, patch) => {
    const bookmarks = get().bookmarks.map((b) => (b.id === id ? { ...b, ...patch } : b))
    set({ bookmarks })
    persist(bookmarks, get().groups)
  },
  moveBookmarkToGroup: (id, groupId) => {
    const bookmarks = get().bookmarks.map((b) => (b.id === id ? { ...b, groupId } : b))
    set({ bookmarks })
    persist(bookmarks, get().groups)
  },
  moveBookmark: (activeId, groupId, overId, side = 'before') => {
    const arr = get().bookmarks.slice()
    const from = arr.findIndex((b) => b.id === activeId)
    if (from < 0) return
    const [item] = arr.splice(from, 1)
    const moved = { ...item, groupId }
    let insertAt: number
    if (overId) {
      const overIdx = arr.findIndex((b) => b.id === overId)
      insertAt = overIdx < 0 ? arr.length : side === 'after' ? overIdx + 1 : overIdx
    } else {
      let lastInGroup = -1
      arr.forEach((b, i) => { if (b.groupId === groupId) lastInGroup = i })
      insertAt = lastInGroup >= 0 ? lastInGroup + 1 : arr.length
    }
    arr.splice(insertAt, 0, moved)
    set({ bookmarks: arr })
    persist(arr, get().groups)
  },
  reorderGroups: (activeId, overId) => {
    const groups = get().groups
    const from = groups.findIndex((g) => g.id === activeId)
    const to = groups.findIndex((g) => g.id === overId)
    if (from < 0 || to < 0 || from === to) return
    const next = move(groups, from, to)
    set({ groups: next })
    persist(get().bookmarks, next)
  },
  removeBookmark: (id) => {
    const bookmarks = get().bookmarks.filter((b) => b.id !== id)
    set({ bookmarks })
    persist(bookmarks, get().groups)
  },
  removeByUrl: (url) => {
    const bookmarks = get().bookmarks.filter((b) => b.url !== url)
    set({ bookmarks })
    persist(bookmarks, get().groups)
  },
  addGroup: (name) => {
    const group: BrowserBookmarkGroup = { id: crypto.randomUUID(), name, createdAt: Date.now() }
    const groups = [...get().groups, group]
    set({ groups })
    persist(get().bookmarks, groups)
    return group
  },
  renameGroup: (id, name) => {
    const groups = get().groups.map((g) => (g.id === id ? { ...g, name } : g))
    set({ groups })
    persist(get().bookmarks, groups)
  },
  removeGroup: (id) => {
    const groups = get().groups.filter((g) => g.id !== id)
    const bookmarks = get().bookmarks.map((b) => (b.groupId === id ? { ...b, groupId: null } : b))
    set({ groups, bookmarks })
    persist(bookmarks, groups)
  },
}))
