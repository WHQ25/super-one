import { create } from 'zustand'
import type { MiniAppEntry, MiniAppInstallResult, MiniAppPreviewResult } from '../../../shared/miniapp-types'

interface MiniAppStoreState {
  apps: MiniAppEntry[]
  loaded: boolean
  _lastProjectDir: string | undefined
  pendingOpenAppId: string | null
  pendingInstall: MiniAppPreviewResult | null
  fetchApps: (projectDir?: string) => Promise<void>
  refreshApps: (projectDir?: string) => Promise<void>
  previewInstall: (s1appPath: string) => Promise<MiniAppPreviewResult>
  confirmInstall: () => Promise<MiniAppInstallResult>
  cancelInstall: () => Promise<void>
  uninstallApp: (appId: string) => Promise<void>
  requestOpenInCanvas: (appId: string) => void
  consumePendingOpen: () => string | null
}

export const useMiniAppStore = create<MiniAppStoreState>((set, get) => ({
  apps: [],
  loaded: false,
  _lastProjectDir: undefined,
  pendingOpenAppId: null,
  pendingInstall: null,
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
  confirmInstall: async () => {
    const pending = get().pendingInstall
    if (!pending) throw new Error('No pending install')
    set({ pendingInstall: null })
    const result = await window.miniapp.confirmInstall(pending.tempDir)
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
}))
