import { create } from 'zustand'
import { useAppStore } from './app'
import { closeMiniAppTab, openMiniAppTab } from '@/components/activity/activity-panel-api'
import type { MiniAppEntry, MiniAppInstallResult, MiniAppPreviewResult } from '@superone/shared/miniapp-types'

interface OpenAppEntry {
  entry: MiniAppEntry
  projectDir: string
  presentation: 'panel' | 'canvas'
}

export interface MiniAppSlot {
  left: number
  top: number
  width: number
  height: number
  mode: 'panel' | 'canvas'
}

interface MiniAppStoreState {
  apps: MiniAppEntry[]
  loaded: boolean
  _lastProjectDir: string | undefined
  _iconRev: number
  pendingOpenAppId: string | null
  pendingInstall: MiniAppPreviewResult | null

  openApps: Record<string, OpenAppEntry>
  slots: Record<string, MiniAppSlot>
  _migratingApps: Set<string>

  fullscreenApp: { appId: string; entry: MiniAppEntry } | null

  fetchApps: (projectDir?: string) => Promise<void>
  refreshApps: (projectDir?: string) => Promise<void>
  previewInstall: (s1appPath: string) => Promise<MiniAppPreviewResult>
  confirmInstall: (installDir?: string, preapprovedTools?: string[]) => Promise<MiniAppInstallResult>
  cancelInstall: () => Promise<void>
  uninstallApp: (appId: string) => Promise<void>

  requestOpenInCanvas: (appId: string) => void
  consumePendingOpen: () => string | null

  openAppInPanel: (entry: MiniAppEntry, projectDir: string) => Promise<void>
  openFullscreenApp: (entry: MiniAppEntry, projectDir: string) => Promise<void>
  closeApp: (appId: string) => Promise<void>
  closeFullscreenApp: () => Promise<void>

  moveAppToCanvas: (appId: string) => void
  moveAppToPanel: (appId: string) => void

  updateSlot: (appId: string, mode: 'panel' | 'canvas', rect: DOMRectReadOnly) => void
  unregisterSlot: (appId: string, mode: 'panel' | 'canvas') => void

  handlePanelRemoved: (appId: string) => void
}

export const useMiniAppStore = create<MiniAppStoreState>((set, get) => {
  if (typeof window !== 'undefined' && window.miniapp?.onDevAppReady) {
    window.miniapp.onDevAppReady(async (projectDir, appId) => {
      const dir = get()._lastProjectDir ?? projectDir
      await get().refreshApps(dir)
      const entry = get().apps.find((a) => a.id === appId)
      if (!entry) return
      await get().openAppInPanel(entry, projectDir)
    })
  }

  function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
    if (!(key in record)) return record
    const next = { ...record }
    delete next[key]
    return next
  }

  return {
    apps: [],
    loaded: false,
    _lastProjectDir: undefined,
    _iconRev: 0,
    pendingOpenAppId: null,
    pendingInstall: null,

    openApps: {},
    slots: {},
    _migratingApps: new Set<string>(),

    fullscreenApp: null,

    fetchApps: async (projectDir?: string) => {
      const state = get()
      if (state.loaded && state._lastProjectDir === projectDir) return
      const apps = await window.miniapp.list(projectDir)
      set({ apps, loaded: true, _lastProjectDir: projectDir })
    },
    refreshApps: async (projectDir?: string) => {
      const apps = await window.miniapp.list(projectDir)
      set({ apps, loaded: true, _lastProjectDir: projectDir, _iconRev: get()._iconRev + 1 })
    },
    previewInstall: async (s1appPath: string) => {
      const preview = await window.miniapp.preview(s1appPath)
      set({ pendingInstall: preview })
      return preview
    },
    confirmInstall: async (installDir?: string, preapprovedTools?: string[]) => {
      const pending = get().pendingInstall
      if (!pending) throw new Error('No pending install')
      set({ pendingInstall: null })
      const result = await window.miniapp.confirmInstall(pending.tempDir, installDir, preapprovedTools)
      await get().refreshApps(get()._lastProjectDir)
      return result
    },
    cancelInstall: async () => {
      const pending = get().pendingInstall
      if (!pending) return
      set({ pendingInstall: null })
      await window.miniapp.cancelInstall(pending.tempDir)
    },
    uninstallApp: async (appId: string) => {
      await window.miniapp.uninstall(appId)
      await get().refreshApps(get()._lastProjectDir)
    },
    requestOpenInCanvas: (appId: string) => set({ pendingOpenAppId: appId }),
    consumePendingOpen: () => {
      const id = get().pendingOpenAppId
      if (id) set({ pendingOpenAppId: null })
      return id
    },

    openAppInPanel: async (entry: MiniAppEntry, projectDir: string) => {
      const existing = get().openApps[entry.id]
      if (existing) {
        openMiniAppTab(entry.id, entry.manifest.name)
        return
      }
      await window.miniapp.open(entry.id, projectDir)
      set((s) => ({
        openApps: {
          ...s.openApps,
          [entry.id]: { entry, projectDir, presentation: 'panel' },
        },
      }))
      openMiniAppTab(entry.id, entry.manifest.name)
    },

    openFullscreenApp: async (entry: MiniAppEntry, projectDir: string) => {
      const existing = get().openApps[entry.id]
      const currentCanvas = get().fullscreenApp
      if (currentCanvas && currentCanvas.appId !== entry.id) {
        await get().closeApp(currentCanvas.appId)
      }
      if (!existing) {
        await window.miniapp.open(entry.id, projectDir)
      }
      set((s) => ({
        openApps: {
          ...s.openApps,
          [entry.id]: { entry, projectDir, presentation: 'canvas' },
        },
        fullscreenApp: { appId: entry.id, entry },
      }))
    },

    closeApp: async (appId: string) => {
      const open = get().openApps[appId]
      if (!open) return
      await window.miniapp.close(appId)
      set((s) => ({
        openApps: withoutKey(s.openApps, appId),
        slots: withoutKey(s.slots, appId),
        fullscreenApp: s.fullscreenApp?.appId === appId ? null : s.fullscreenApp,
      }))
      if (open.presentation === 'panel') {
        closeMiniAppTab(appId)
      } else {
        useAppStore.getState().setLayoutMode('coding')
      }
    },

    closeFullscreenApp: async () => {
      const current = get().fullscreenApp
      if (!current) return
      await get().closeApp(current.appId)
    },

    moveAppToCanvas: (appId: string) => {
      const open = get().openApps[appId]
      if (!open) return
      set((s) => ({ _migratingApps: new Set([...s._migratingApps, appId]) }))
      closeMiniAppTab(appId)
      set((s) => ({
        openApps: {
          ...s.openApps,
          [appId]: { ...open, presentation: 'canvas' },
        },
        fullscreenApp: { appId, entry: open.entry },
      }))
      useAppStore.getState().setLayoutMode('canvas')
    },

    moveAppToPanel: (appId: string) => {
      const open = get().openApps[appId]
      if (!open) return
      set((s) => ({
        openApps: {
          ...s.openApps,
          [appId]: { ...open, presentation: 'panel' },
        },
        fullscreenApp: s.fullscreenApp?.appId === appId ? null : s.fullscreenApp,
      }))
      useAppStore.getState().setLayoutMode('coding')
      openMiniAppTab(appId, open.entry.manifest.name)
    },

    updateSlot: (appId: string, mode: 'panel' | 'canvas', rect: DOMRectReadOnly) => {
      const prev = get().slots[appId]
      const left = Math.round(rect.left)
      const top = Math.round(rect.top)
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      if (prev && prev.mode === mode && prev.left === left && prev.top === top && prev.width === width && prev.height === height) return
      set((s) => ({
        slots: { ...s.slots, [appId]: { mode, left, top, width, height } },
      }))
    },

    unregisterSlot: (appId: string, mode: 'panel' | 'canvas') => {
      const prev = get().slots[appId]
      if (!prev || prev.mode !== mode) return
      set((s) => ({ slots: withoutKey(s.slots, appId) }))
    },

    handlePanelRemoved: (appId: string) => {
      const migrating = get()._migratingApps.has(appId)
      if (migrating) {
        set((s) => {
          const next = new Set(s._migratingApps)
          next.delete(appId)
          return { _migratingApps: next }
        })
        return
      }
      void get().closeApp(appId)
    },
  }
})
