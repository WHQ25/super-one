import { create } from 'zustand'
import { withoutKey } from '@/lib/record'

export interface BrowserTabState {
  url: string
  title: string
  favicon: string | null
  loading: boolean
  hasCustomBlankContent: boolean
  canGoBack: boolean
  canGoForward: boolean
  owner: string | null
  certError: { url: string; error: string } | null
}

export type BrowserSlotMode = 'panel' | 'pip' | 'overlay'

export type AnnotateQuickMode = 'plain' | 'shot'

export interface BrowserSlot {
  mode: BrowserSlotMode
  left: number
  top: number
  width: number
  height: number
}

export interface BrowserEmulation {
  width: number
  height: number
}

interface BrowserStore {
  tabs: Record<string, BrowserTabState>
  /** Dockview-owned browser geometry. Kept stable while PiP temporarily mounts. */
  slots: Record<string, BrowserSlot>
  pipSlots: Record<string, BrowserSlot>
  overlaySlots: Record<string, BrowserSlot>
  emulations: Record<string, BrowserEmulation>
  captureRefs: Record<string, number>
  automationCounts: Record<string, number>
  activeAutomationId: string | null
  pendingPreviewBrowserId: string | null
  automationPreviewBrowserId: string | null
  /** Ready automatic previews keyed by tab so background sessions do not overwrite each other. */
  automationPreviewReady: Record<string, boolean>
  expandedBrowserId: string | null
  pinnedPipBrowserId: string | null
  hiddenPreviewBrowserId: string | null
  annotatingId: string | null
  annotateQuick: AnnotateQuickMode | null
  insecureHosts: Record<string, string>
  markInsecure: (host: string, error: string) => void
  ensure: (id: string, url: string, owner?: string | null) => void
  patch: (id: string, partial: Partial<BrowserTabState>) => void
  remove: (id: string) => void
  startAnnotate: (id: string, quick?: AnnotateQuickMode | null) => void
  stopAnnotate: () => void
  setEmulation: (id: string, emulation: BrowserEmulation | null) => void
  beginCapture: (id: string) => void
  endCapture: (id: string) => void
  beginAutomation: (id: string) => void
  endAutomation: (id: string) => void
  markAutomationPreviewReady: (id: string) => void
  clearAutomationPreview: (sessionId?: string) => void
  expandPreview: (id: string) => void
  shrinkPreview: (id: string) => void
  hidePreview: (id: string) => void
  clearManualPreview: () => void
  updateSlot: (id: string, mode: BrowserSlotMode, rect: DOMRectReadOnly) => void
  unregisterSlot: (id: string, mode: BrowserSlotMode) => void
}

const DEFAULT_TAB: BrowserTabState = {
  url: '',
  title: '',
  favicon: null,
  loading: false,
  hasCustomBlankContent: false,
  canGoBack: false,
  canGoForward: false,
  owner: null,
  certError: null,
}

export const useBrowserStore = create<BrowserStore>((set) => ({
  tabs: {},
  slots: {},
  pipSlots: {},
  overlaySlots: {},
  emulations: {},
  captureRefs: {},
  automationCounts: {},
  activeAutomationId: null,
  pendingPreviewBrowserId: null,
  automationPreviewBrowserId: null,
  automationPreviewReady: {},
  expandedBrowserId: null,
  pinnedPipBrowserId: null,
  hiddenPreviewBrowserId: null,
  annotatingId: null,
  annotateQuick: null,
  insecureHosts: {},
  markInsecure: (host, error) =>
    set((s) => (s.insecureHosts[host] === error ? s : { insecureHosts: { ...s.insecureHosts, [host]: error } })),
  startAnnotate: (id, quick = null) => set({ annotatingId: id, annotateQuick: quick }),
  stopAnnotate: () => set({ annotatingId: null, annotateQuick: null }),
  ensure: (id, url, owner = null) =>
    set((s) => (s.tabs[id] ? s : { tabs: { ...s.tabs, [id]: { ...DEFAULT_TAB, url, owner } } })),
  patch: (id, partial) =>
    set((s) => (s.tabs[id] ? { tabs: { ...s.tabs, [id]: { ...s.tabs[id], ...partial } } } : s)),
  remove: (id) =>
    set((s) => ({
      tabs: withoutKey(s.tabs, id),
      slots: withoutKey(s.slots, id),
      pipSlots: withoutKey(s.pipSlots, id),
      overlaySlots: withoutKey(s.overlaySlots, id),
      emulations: withoutKey(s.emulations, id),
      captureRefs: withoutKey(s.captureRefs, id),
      automationCounts: withoutKey(s.automationCounts, id),
      activeAutomationId: s.activeAutomationId === id ? null : s.activeAutomationId,
      pendingPreviewBrowserId: s.pendingPreviewBrowserId === id ? null : s.pendingPreviewBrowserId,
      automationPreviewBrowserId: s.automationPreviewBrowserId === id ? null : s.automationPreviewBrowserId,
      automationPreviewReady: withoutKey(s.automationPreviewReady, id),
      expandedBrowserId: s.expandedBrowserId === id ? null : s.expandedBrowserId,
      pinnedPipBrowserId: s.pinnedPipBrowserId === id ? null : s.pinnedPipBrowserId,
      hiddenPreviewBrowserId: s.hiddenPreviewBrowserId === id ? null : s.hiddenPreviewBrowserId,
      annotatingId: s.annotatingId === id ? null : s.annotatingId,
      annotateQuick: s.annotatingId === id ? null : s.annotateQuick,
    })),
  setEmulation: (id, emulation) =>
    set((s) => (emulation ? { emulations: { ...s.emulations, [id]: emulation } } : { emulations: withoutKey(s.emulations, id) })),
  beginCapture: (id) =>
    set((s) => ({ captureRefs: { ...s.captureRefs, [id]: (s.captureRefs[id] ?? 0) + 1 } })),
  endCapture: (id) =>
    set((s) => {
      const next = (s.captureRefs[id] ?? 0) - 1
      return { captureRefs: next > 0 ? { ...s.captureRefs, [id]: next } : withoutKey(s.captureRefs, id) }
    }),
  // Readiness is a first-paint gate, not a per-call one: it keeps a blank tab off
  // screen until it has something to show. Once a tab has been presentable it stays
  // presentable for the rest of the turn — re-gating it here made the preview blink
  // on every navigation and on every call issued while the page was still loading.
  beginAutomation: (id) =>
    set((s) => ({
      automationCounts: { ...s.automationCounts, [id]: (s.automationCounts[id] ?? 0) + 1 },
      activeAutomationId: id,
      pendingPreviewBrowserId: id,
      hiddenPreviewBrowserId: s.hiddenPreviewBrowserId === id ? null : s.hiddenPreviewBrowserId,
    })),
  endAutomation: (id) =>
    set((s) => {
      const nextCount = Math.max(0, (s.automationCounts[id] ?? 0) - 1)
      const automationCounts = nextCount > 0
        ? { ...s.automationCounts, [id]: nextCount }
        : withoutKey(s.automationCounts, id)
      const activeAutomationId = s.activeAutomationId === id && nextCount === 0
        ? Object.keys(automationCounts).at(-1) ?? null
        : s.activeAutomationId
      return { automationCounts, activeAutomationId }
    }),
  markAutomationPreviewReady: (id) =>
    set((s) => s.tabs[id] && !s.tabs[id].loading
      ? {
          pendingPreviewBrowserId: s.pendingPreviewBrowserId === id
            ? null
            : s.pendingPreviewBrowserId,
          automationPreviewBrowserId: id,
          automationPreviewReady: { ...s.automationPreviewReady, [id]: true },
        }
      : s),
  clearAutomationPreview: (sessionId) => set((s) => {
    if (!sessionId) {
      return { pendingPreviewBrowserId: null, automationPreviewBrowserId: null, automationPreviewReady: {} }
    }
    const automationPreviewReady = Object.fromEntries(
      Object.entries(s.automationPreviewReady)
        .filter(([id]) => s.tabs[id]?.owner !== sessionId),
    )
    const pending = s.pendingPreviewBrowserId
    const automatic = s.automationPreviewBrowserId
    return {
      automationPreviewReady,
      pendingPreviewBrowserId: pending && s.tabs[pending]?.owner === sessionId ? null : pending,
      automationPreviewBrowserId: automatic && s.tabs[automatic]?.owner === sessionId ? null : automatic,
    }
  }),
  expandPreview: (id) => set({
    expandedBrowserId: id,
    pinnedPipBrowserId: null,
    hiddenPreviewBrowserId: null,
  }),
  shrinkPreview: (id) => set((s) => ({
    expandedBrowserId: s.expandedBrowserId === id ? null : s.expandedBrowserId,
    pinnedPipBrowserId: id,
    hiddenPreviewBrowserId: null,
  })),
  hidePreview: (id) => set((s) => ({
    pendingPreviewBrowserId: s.pendingPreviewBrowserId === id ? null : s.pendingPreviewBrowserId,
    automationPreviewBrowserId: s.automationPreviewBrowserId === id ? null : s.automationPreviewBrowserId,
    expandedBrowserId: s.expandedBrowserId === id ? null : s.expandedBrowserId,
    pinnedPipBrowserId: s.pinnedPipBrowserId === id ? null : s.pinnedPipBrowserId,
    hiddenPreviewBrowserId: id,
  })),
  clearManualPreview: () => set({
    expandedBrowserId: null,
    pinnedPipBrowserId: null,
    hiddenPreviewBrowserId: null,
  }),
  updateSlot: (id, mode, rect) =>
    set((s) => {
      const target = mode === 'pip' ? s.pipSlots : mode === 'overlay' ? s.overlaySlots : s.slots
      const prev = target[id]
      const left = Math.round(rect.left), top = Math.round(rect.top)
      const width = Math.round(rect.width), height = Math.round(rect.height)
      if (prev && prev.mode === mode && prev.left === left && prev.top === top && prev.width === width && prev.height === height) return s
      const next = { ...target, [id]: { mode, left, top, width, height } }
      return mode === 'pip' ? { pipSlots: next } : mode === 'overlay' ? { overlaySlots: next } : { slots: next }
    }),
  unregisterSlot: (id, mode) =>
    set((s) => {
      const target = mode === 'pip' ? s.pipSlots : mode === 'overlay' ? s.overlaySlots : s.slots
      const prev = target[id]
      if (!prev || prev.mode !== mode) return s
      return mode === 'pip'
        ? { pipSlots: withoutKey(s.pipSlots, id) }
        : mode === 'overlay'
          ? { overlaySlots: withoutKey(s.overlaySlots, id) }
          : { slots: withoutKey(s.slots, id) }
    }),
}))
