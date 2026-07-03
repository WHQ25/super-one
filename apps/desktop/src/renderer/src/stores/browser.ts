import { create } from 'zustand'

export interface BrowserTabState {
  url: string
  title: string
  favicon: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  owner: string | null
  certError: { url: string; error: string } | null
}

export type BrowserSlotMode = 'panel' | 'canvas'

export interface BrowserSlot {
  mode: BrowserSlotMode
  left: number
  top: number
  width: number
  height: number
}

interface BrowserStore {
  tabs: Record<string, BrowserTabState>
  slots: Record<string, BrowserSlot>
  fullscreenId: string | null
  annotatingId: string | null
  insecureHosts: Record<string, string>
  markInsecure: (host: string, error: string) => void
  ensure: (id: string, url: string, owner?: string | null) => void
  patch: (id: string, partial: Partial<BrowserTabState>) => void
  remove: (id: string) => void
  setFullscreen: (id: string | null) => void
  startAnnotate: (id: string) => void
  stopAnnotate: () => void
  updateSlot: (id: string, mode: BrowserSlotMode, rect: DOMRectReadOnly) => void
  unregisterSlot: (id: string, mode: BrowserSlotMode) => void
}

const DEFAULT_TAB: BrowserTabState = {
  url: '',
  title: '',
  favicon: null,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  owner: null,
  certError: null,
}

function withoutKey<T extends Record<string, unknown>>(obj: T, key: string): T {
  if (!(key in obj)) return obj
  const next = { ...obj }
  delete next[key]
  return next
}

export const useBrowserStore = create<BrowserStore>((set) => ({
  tabs: {},
  slots: {},
  fullscreenId: null,
  annotatingId: null,
  insecureHosts: {},
  markInsecure: (host, error) =>
    set((s) => (s.insecureHosts[host] === error ? s : { insecureHosts: { ...s.insecureHosts, [host]: error } })),
  setFullscreen: (id) => set({ fullscreenId: id }),
  startAnnotate: (id) => set({ annotatingId: id }),
  stopAnnotate: () => set({ annotatingId: null }),
  ensure: (id, url, owner = null) =>
    set((s) => (s.tabs[id] ? s : { tabs: { ...s.tabs, [id]: { ...DEFAULT_TAB, url, owner } } })),
  patch: (id, partial) =>
    set((s) => (s.tabs[id] ? { tabs: { ...s.tabs, [id]: { ...s.tabs[id], ...partial } } } : s)),
  remove: (id) =>
    set((s) => ({
      tabs: withoutKey(s.tabs, id),
      slots: withoutKey(s.slots, id),
      annotatingId: s.annotatingId === id ? null : s.annotatingId,
    })),
  updateSlot: (id, mode, rect) =>
    set((s) => {
      const prev = s.slots[id]
      const left = Math.round(rect.left), top = Math.round(rect.top)
      const width = Math.round(rect.width), height = Math.round(rect.height)
      if (prev && prev.mode === mode && prev.left === left && prev.top === top && prev.width === width && prev.height === height) return s
      return { slots: { ...s.slots, [id]: { mode, left, top, width, height } } }
    }),
  unregisterSlot: (id, mode) =>
    set((s) => {
      const prev = s.slots[id]
      if (!prev || prev.mode !== mode) return s
      return { slots: withoutKey(s.slots, id) }
    }),
}))
