import { create } from 'zustand'
import { useAppStore } from './app'
import { useActivityPanelStore } from './activity-panel'
import { useChatStore } from './chat'
import { closeMiniAppTab, openMiniAppTab } from '@/components/activity/activity-panel-api'
import { LAYOUT } from '@/lib/layout-constants'
import { NO_PROJECT_KEY } from '@superone/shared/miniapp-host'
import type { MiniAppEntry, MiniAppInstallResult, MiniAppPreviewResult, MiniAppWorkerInfo } from '@superone/shared/miniapp-types'

function activeSessionId(projectDir: string): string {
  const chat = useChatStore.getState()
  let proj = chat.projectSessions[projectDir]
  if (!proj?._activeSessionId && projectDir) {
    chat.ensureSession(projectDir)
    proj = useChatStore.getState().projectSessions[projectDir]
  }
  return proj?._activeSessionId ?? ''
}

export function makeInstanceKey(appId: string, projectId: string | null): string {
  return `${appId}:${projectId ?? NO_PROJECT_KEY}`
}

function applyPreferWidth(preferWidth: number): void {
  if (typeof window === 'undefined') return
  const appState = useAppStore.getState()
  const sidebarReserved = appState.showSidebar ? appState.sidebarWidth : 0
  const maxAp = window.innerWidth - sidebarReserved - LAYOUT.MIN_MAIN - LAYOUT.CARD_GUTTER
  if (maxAp < LAYOUT.MIN_AP) return
  const clamped = Math.max(LAYOUT.MIN_AP, Math.min(preferWidth, maxAp))
  useActivityPanelStore.getState().setPanelWidth(clamped)
}

export interface OpenAppEntry {
  instanceKey: string
  entry: MiniAppEntry
  projectDir: string
  projectId: string | null
  holderSessions: Set<string>
}

export interface MiniAppDevControls {
  reload: () => void
  openDevTools: () => void
}

export interface MiniAppSlot {
  left: number
  top: number
  width: number
  height: number
  mode: 'panel'
}

interface MiniAppStoreState {
  apps: MiniAppEntry[]
  loaded: boolean
  _lastProjectDir: string | undefined
  _iconRev: number
  pendingInstall: MiniAppPreviewResult | null

  openApps: Record<string, OpenAppEntry>
  slots: Record<string, MiniAppSlot>

  workers: MiniAppWorkerInfo[]

  devControls: Record<string, MiniAppDevControls>
  registerDevControls: (instanceKey: string, controls: MiniAppDevControls) => void
  unregisterDevControls: (instanceKey: string) => void

  fetchApps: (projectDir?: string) => Promise<void>
  refreshApps: (projectDir?: string) => Promise<void>
  previewInstall: (s1appPath: string) => Promise<MiniAppPreviewResult>
  confirmInstall: (installDir?: string, preapprovedTools?: string[]) => Promise<MiniAppInstallResult>
  cancelInstall: () => Promise<void>
  uninstallApp: (appId: string, installDir?: string) => Promise<void>

  openAppInPanel: (entry: MiniAppEntry, projectDir: string) => Promise<void>
  closeApp: (instanceKey: string) => Promise<void>

  updateSlot: (instanceKey: string, mode: 'panel', rect: DOMRectReadOnly) => void
  unregisterSlot: (instanceKey: string, mode: 'panel') => void
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

  if (typeof window !== 'undefined' && window.miniapp?.onWorkerState) {
    window.miniapp.onWorkerState((workers) => set({ workers }))
    window.miniapp.workerList().then((workers) => set({ workers })).catch(() => {})
  }

  if (typeof window !== 'undefined' && window.miniapp?.onLazyOpenRequest) {
    window.miniapp.onLazyOpenRequest(async ({ appId, projectDir }) => {
      window.app.trace?.('miniapp.lazyopen', 'renderer-received', { appId, projectDir, loaded: get().loaded, appsCount: get().apps.length })
      if (!get().loaded) await get().fetchApps(projectDir)
      const entry = get().apps.find((a) => a.id === appId)
      if (!entry) {
        window.app.trace?.('miniapp.lazyopen', 'renderer-app-missing-refresh', { appId, projectDir })
        await get().refreshApps(projectDir)
        const refreshed = get().apps.find((a) => a.id === appId)
        if (!refreshed) {
          window.app.trace?.('miniapp.lazyopen', 'renderer-app-still-missing-abort', { appId, projectDir })
          return
        }
        window.app.trace?.('miniapp.lazyopen', 'renderer-openAppInPanel-after-refresh', { appId, projectDir })
        await get().openAppInPanel(refreshed, projectDir)
        return
      }
      window.app.trace?.('miniapp.lazyopen', 'renderer-openAppInPanel', { appId, projectDir })
      await get().openAppInPanel(entry, projectDir)
      window.app.trace?.('miniapp.lazyopen', 'renderer-openAppInPanel-done', { appId, projectDir })
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
    pendingInstall: null,

    openApps: {},
    slots: {},

    workers: [],

    devControls: {},
    registerDevControls: (instanceKey, controls) =>
      set((s) => ({ devControls: { ...s.devControls, [instanceKey]: controls } })),
    unregisterDevControls: (instanceKey) =>
      set((s) => {
        if (!(instanceKey in s.devControls)) return s
        const next = { ...s.devControls }
        delete next[instanceKey]
        return { devControls: next }
      }),

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
      const openInstances = Object.entries(get().openApps)
        .filter(([, v]) => v.entry.id === appId)
      if (openInstances.length > 0) {
        for (const [, v] of openInstances) {
          for (const sid of v.holderSessions) {
            await window.miniapp.close(appId, v.projectDir, sid)
          }
        }
        for (const [key] of openInstances) {
          closeMiniAppTab(key)
        }
        set((s) => {
          const nextOpenApps = { ...s.openApps }
          const nextSlots = { ...s.slots }
          for (const [key] of openInstances) {
            delete nextOpenApps[key]
            delete nextSlots[key]
          }
          return {
            openApps: nextOpenApps,
            slots: nextSlots,
          }
        })
      }
      await window.miniapp.uninstall(appId, installDir)
      await get().refreshApps(get()._lastProjectDir)
    },
    openAppInPanel: async (entry: MiniAppEntry, projectDir: string) => {
      const projectId = useAppStore.getState().currentProjectId
      const instanceKey = makeInstanceKey(entry.id, projectId)
      const sid = activeSessionId(projectDir)
      const existing = get().openApps[instanceKey]
      await window.miniapp.open(entry.id, projectDir, sid)
      if (existing) {
        if (!existing.holderSessions.has(sid)) {
          set((s) => ({
            openApps: {
              ...s.openApps,
              [instanceKey]: {
                ...existing,
                holderSessions: new Set([...existing.holderSessions, sid]),
              },
            },
          }))
        }
        openMiniAppTab(instanceKey, entry.id, entry.manifest.name)
        return
      }
      set((s) => ({
        openApps: {
          ...s.openApps,
          [instanceKey]: {
            instanceKey,
            entry,
            projectDir,
            projectId,
            holderSessions: new Set([sid]),
          },
        },
      }))
      if (entry.manifest.preferWidth) {
        applyPreferWidth(entry.manifest.preferWidth)
      }
      openMiniAppTab(instanceKey, entry.id, entry.manifest.name)
    },

    closeApp: async (instanceKey: string) => {
      const open = get().openApps[instanceKey]
      if (!open) return
      const appId = open.entry.id
      const projectDir = open.projectDir
      const sid = activeSessionId(projectDir)

      closeMiniAppTab(instanceKey)

      await window.miniapp.close(appId, projectDir, sid)

      const remainingHolders = new Set(open.holderSessions)
      remainingHolders.delete(sid)

      if (remainingHolders.size > 0) {
        set((s) => ({
          openApps: {
            ...s.openApps,
            [instanceKey]: { ...open, holderSessions: remainingHolders },
          },
          slots: withoutKey(s.slots, instanceKey),
        }))
        return
      }
      set((s) => ({
        openApps: withoutKey(s.openApps, instanceKey),
        slots: withoutKey(s.slots, instanceKey),
      }))
    },

    updateSlot: (instanceKey: string, mode: 'panel', rect: DOMRectReadOnly) => {
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

    unregisterSlot: (instanceKey: string, mode: 'panel') => {
      const prev = get().slots[instanceKey]
      if (!prev || prev.mode !== mode) return
      set((s) => ({ slots: withoutKey(s.slots, instanceKey) }))
    },
  }
})
