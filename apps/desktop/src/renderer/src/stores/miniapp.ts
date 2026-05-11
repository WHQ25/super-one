import { create } from 'zustand'
import { useAppStore } from './app'
import { useActivityPanelStore } from './activity-panel'
import { isInstanceReferencedInSavedSessions } from './activity-view-state'
import { closeMiniAppTab, openMiniAppTab } from '@/components/activity/activity-panel-api'
import { LAYOUT } from '@/lib/layout-constants'
import { NO_PROJECT_KEY } from '@superone/shared/miniapp-host'
import type { MiniAppEntry, MiniAppInstallResult, MiniAppPreviewResult } from '@superone/shared/miniapp-types'

export function makeInstanceKey(appId: string, projectId: string | null): string {
  return `${appId}:${projectId ?? NO_PROJECT_KEY}`
}

function applyPreferWidth(preferWidth: number): void {
  if (typeof window === 'undefined') return
  const appState = useAppStore.getState()
  const sidebarReserved = appState.showSidebar ? appState.sidebarWidth : 0
  const maxAp = window.innerWidth - sidebarReserved - LAYOUT.MIN_MAIN
  if (maxAp < LAYOUT.MIN_AP) return
  const clamped = Math.max(LAYOUT.MIN_AP, Math.min(preferWidth, maxAp))
  useActivityPanelStore.getState().setPanelWidth(clamped)
}

export interface OpenAppEntry {
  instanceKey: string
  entry: MiniAppEntry
  projectDir: string
  projectId: string | null
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

  fullscreenApp: { instanceKey: string; entry: MiniAppEntry } | null

  fetchApps: (projectDir?: string) => Promise<void>
  refreshApps: (projectDir?: string) => Promise<void>
  previewInstall: (s1appPath: string) => Promise<MiniAppPreviewResult>
  confirmInstall: (installDir?: string, preapprovedTools?: string[]) => Promise<MiniAppInstallResult>
  cancelInstall: () => Promise<void>
  uninstallApp: (appId: string, installDir?: string) => Promise<void>

  requestOpenInCanvas: (appId: string) => void
  consumePendingOpen: () => string | null

  openAppInPanel: (entry: MiniAppEntry, projectDir: string) => Promise<void>
  openFullscreenApp: (entry: MiniAppEntry, projectDir: string) => Promise<void>
  closeApp: (instanceKey: string) => Promise<void>
  closeFullscreenApp: () => Promise<void>

  moveAppToCanvas: (instanceKey: string) => void
  moveAppToPanel: (instanceKey: string) => void

  updateSlot: (instanceKey: string, mode: 'panel' | 'canvas', rect: DOMRectReadOnly) => void
  unregisterSlot: (instanceKey: string, mode: 'panel' | 'canvas') => void
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

  function hasOtherInstanceOfApp(openApps: Record<string, OpenAppEntry>, instanceKey: string, appId: string): boolean {
    for (const [k, v] of Object.entries(openApps)) {
      if (k !== instanceKey && v.entry.id === appId) return true
    }
    return false
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
    uninstallApp: async (appId: string, installDir?: string) => {
      const openInstanceKeys = Object.entries(get().openApps)
        .filter(([, v]) => v.entry.id === appId)
        .map(([k]) => k)
      if (openInstanceKeys.length > 0) {
        await window.miniapp.close(appId)
        for (const key of openInstanceKeys) {
          closeMiniAppTab(key)
        }
        set((s) => {
          const nextOpenApps = { ...s.openApps }
          const nextSlots = { ...s.slots }
          for (const key of openInstanceKeys) {
            delete nextOpenApps[key]
            delete nextSlots[key]
          }
          const fullscreenCleared = s.fullscreenApp && openInstanceKeys.includes(s.fullscreenApp.instanceKey)
          return {
            openApps: nextOpenApps,
            slots: nextSlots,
            fullscreenApp: fullscreenCleared ? null : s.fullscreenApp,
          }
        })
      }
      await window.miniapp.uninstall(appId, installDir)
      await get().refreshApps(get()._lastProjectDir)
    },
    requestOpenInCanvas: (appId: string) => set({ pendingOpenAppId: appId }),
    consumePendingOpen: () => {
      const id = get().pendingOpenAppId
      if (id) set({ pendingOpenAppId: null })
      return id
    },

    openAppInPanel: async (entry: MiniAppEntry, projectDir: string) => {
      const projectId = useAppStore.getState().currentProjectId
      const instanceKey = makeInstanceKey(entry.id, projectId)
      const existing = get().openApps[instanceKey]
      if (existing) {
        openMiniAppTab(instanceKey, entry.id, entry.manifest.name)
        return
      }
      const isFirstInstanceOfApp = !hasOtherInstanceOfApp(get().openApps, instanceKey, entry.id)
      if (isFirstInstanceOfApp) {
        await window.miniapp.open(entry.id, projectDir)
      }
      set((s) => ({
        openApps: {
          ...s.openApps,
          [instanceKey]: { instanceKey, entry, projectDir, projectId, presentation: 'panel' },
        },
      }))
      if (entry.manifest.preferWidth) {
        applyPreferWidth(entry.manifest.preferWidth)
      }
      openMiniAppTab(instanceKey, entry.id, entry.manifest.name)
    },

    openFullscreenApp: async (entry: MiniAppEntry, projectDir: string) => {
      const projectId = useAppStore.getState().currentProjectId
      const instanceKey = makeInstanceKey(entry.id, projectId)
      const existing = get().openApps[instanceKey]
      const currentCanvas = get().fullscreenApp
      if (currentCanvas && currentCanvas.instanceKey !== instanceKey) {
        await get().closeApp(currentCanvas.instanceKey)
      }
      const isFirstInstanceOfApp = !existing && !hasOtherInstanceOfApp(get().openApps, instanceKey, entry.id)
      if (isFirstInstanceOfApp) {
        await window.miniapp.open(entry.id, projectDir)
      }
      set((s) => ({
        openApps: {
          ...s.openApps,
          [instanceKey]: { instanceKey, entry, projectDir, projectId, presentation: 'canvas' },
        },
        fullscreenApp: { instanceKey, entry },
      }))
    },

    closeApp: async (instanceKey: string) => {
      const open = get().openApps[instanceKey]
      if (!open) return
      const appId = open.entry.id
      const wasCanvas = open.presentation === 'canvas'

      if (!wasCanvas) {
        closeMiniAppTab(instanceKey)
      }

      if (isInstanceReferencedInSavedSessions(instanceKey)) {
        set((s) => ({
          slots: withoutKey(s.slots, instanceKey),
          fullscreenApp: s.fullscreenApp?.instanceKey === instanceKey ? null : s.fullscreenApp,
        }))
        if (wasCanvas) useAppStore.getState().setLayoutMode('coding')
        return
      }

      const isLastInstanceOfApp = !hasOtherInstanceOfApp(get().openApps, instanceKey, appId)
      if (isLastInstanceOfApp) {
        await window.miniapp.close(appId)
      }
      set((s) => ({
        openApps: withoutKey(s.openApps, instanceKey),
        slots: withoutKey(s.slots, instanceKey),
        fullscreenApp: s.fullscreenApp?.instanceKey === instanceKey ? null : s.fullscreenApp,
      }))
      if (wasCanvas) useAppStore.getState().setLayoutMode('coding')
    },

    closeFullscreenApp: async () => {
      const current = get().fullscreenApp
      if (!current) return
      await get().closeApp(current.instanceKey)
    },

    moveAppToCanvas: (instanceKey: string) => {
      const open = get().openApps[instanceKey]
      if (!open) return
      closeMiniAppTab(instanceKey)
      set((s) => ({
        openApps: {
          ...s.openApps,
          [instanceKey]: { ...open, presentation: 'canvas' },
        },
        fullscreenApp: { instanceKey, entry: open.entry },
      }))
      useAppStore.getState().setLayoutMode('canvas')
    },

    moveAppToPanel: (instanceKey: string) => {
      const open = get().openApps[instanceKey]
      if (!open) return
      set((s) => ({
        openApps: {
          ...s.openApps,
          [instanceKey]: { ...open, presentation: 'panel' },
        },
        fullscreenApp: s.fullscreenApp?.instanceKey === instanceKey ? null : s.fullscreenApp,
      }))
      useAppStore.getState().setLayoutMode('coding')
      openMiniAppTab(instanceKey, open.entry.id, open.entry.manifest.name)
    },

    updateSlot: (instanceKey: string, mode: 'panel' | 'canvas', rect: DOMRectReadOnly) => {
      const prev = get().slots[instanceKey]
      const left = Math.round(rect.left)
      const top = Math.round(rect.top)
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      if (prev && prev.mode === mode && prev.left === left && prev.top === top && prev.width === width && prev.height === height) return
      set((s) => ({
        slots: { ...s.slots, [instanceKey]: { mode, left, top, width, height } },
      }))
    },

    unregisterSlot: (instanceKey: string, mode: 'panel' | 'canvas') => {
      const prev = get().slots[instanceKey]
      if (!prev || prev.mode !== mode) return
      set((s) => ({ slots: withoutKey(s.slots, instanceKey) }))
    },
  }
})
