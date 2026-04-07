import { create } from 'zustand'
import type { MiniAppEntry, MiniAppInstallResult, MiniAppPreviewResult } from '../../../shared/miniapp-types'

interface MiniAppStoreState {
  apps: MiniAppEntry[]
  loaded: boolean
  _lastProjectDir: string | undefined
  pendingOpenAppId: string | null
  pendingInstall: MiniAppPreviewResult | null
  fullscreenApp: { appId: string; entry: MiniAppEntry } | null
  fetchApps: (projectDir?: string) => Promise<void>
  refreshApps: (projectDir?: string) => Promise<void>
  previewInstall: (s1appPath: string) => Promise<MiniAppPreviewResult>
  confirmInstall: (installDir?: string) => Promise<MiniAppInstallResult>
  cancelInstall: () => Promise<void>
  uninstallApp: (appId: string) => Promise<void>
  requestOpenInCanvas: (appId: string) => void
  consumePendingOpen: () => string | null
  openFullscreenApp: (entry: MiniAppEntry, projectDir: string) => Promise<void>
  closeFullscreenApp: () => Promise<void>
}

export const useMiniAppStore = create<MiniAppStoreState>((set, get) => ({
  apps: [],
  loaded: false,
  _lastProjectDir: undefined,
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
    set({ apps, loaded: true, _lastProjectDir: projectDir })
  },
  previewInstall: async (s1appPath: string) => {
    const preview = await window.miniapp.preview(s1appPath)
    set({ pendingInstall: preview })
    return preview
  },
  confirmInstall: async (installDir?: string) => {
    const pending = get().pendingInstall
    if (!pending) throw new Error('No pending install')
    set({ pendingInstall: null })
    const result = await window.miniapp.confirmInstall(pending.tempDir, installDir)
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
}))
