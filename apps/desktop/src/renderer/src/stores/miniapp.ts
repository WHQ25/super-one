import { create } from 'zustand'
import { useAppStore } from './app'
import { openMiniAppTab } from '@/components/activity/activity-panel-api'
import type { MiniAppEntry, MiniAppInstallResult, MiniAppPreviewResult } from '@superone/shared/miniapp-types'

interface MiniAppStoreState {
  apps: MiniAppEntry[]
  loaded: boolean
  _lastProjectDir: string | undefined
  _iconRev: number
  pendingOpenAppId: string | null
  pendingInstall: MiniAppPreviewResult | null
  fullscreenApp: { appId: string; entry: MiniAppEntry } | null
  fetchApps: (projectDir?: string) => Promise<void>
  refreshApps: (projectDir?: string) => Promise<void>
  previewInstall: (s1appPath: string) => Promise<MiniAppPreviewResult>
  confirmInstall: (installDir?: string, preapprovedTools?: string[]) => Promise<MiniAppInstallResult>
  cancelInstall: () => Promise<void>
  uninstallApp: (appId: string) => Promise<void>
  requestOpenInCanvas: (appId: string) => void
  consumePendingOpen: () => string | null
  openFullscreenApp: (entry: MiniAppEntry, projectDir: string) => Promise<void>
  closeFullscreenApp: () => Promise<void>
}

export const useMiniAppStore = create<MiniAppStoreState>((set, get) => {
  if (typeof window !== 'undefined' && window.miniapp?.onDevAppReady) {
    window.miniapp.onDevAppReady(async (projectDir, appId) => {
      const dir = get()._lastProjectDir ?? projectDir
      await get().refreshApps(dir)
      const entry = get().apps.find((a) => a.id === appId)
      if (!entry) return
      const type = entry.manifest.type ?? 'panel'
      if (type === 'sidebar') {
        useAppStore.getState().setSidebarTab(`miniapp:${entry.id}`)
      } else if (type === 'fullscreen') {
        useAppStore.getState().setLayoutMode('canvas')
        get().requestOpenInCanvas(entry.id)
      } else if (type === 'panel') {
        window.miniapp.open(entry.id, projectDir)
        openMiniAppTab(entry.id, entry.manifest.name)
      }
    })
  }

  return {
  apps: [],
  loaded: false,
  _lastProjectDir: undefined,
  _iconRev: 0,
  pendingOpenAppId: null,
  pendingInstall: null,
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
  openFullscreenApp: async (entry: MiniAppEntry, projectDir: string) => {
    const current = get().fullscreenApp
    if (current?.appId === entry.id) return
    if (current) await window.miniapp.close(current.appId)
    await window.miniapp.open(entry.id, projectDir)
    set({ fullscreenApp: { appId: entry.id, entry } })
  },
  closeFullscreenApp: async () => {
    const current = get().fullscreenApp
    if (!current) return
    await window.miniapp.close(current.appId)
    set({ fullscreenApp: null })
  },
}})
