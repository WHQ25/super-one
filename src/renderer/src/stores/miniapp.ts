import { create } from 'zustand'
import type { MiniAppEntry, MiniAppInstallResult, MiniAppPreviewResult } from '../../../shared/miniapp-types'

interface MiniAppStoreState {
  apps: MiniAppEntry[]
  loaded: boolean
  pendingOpenAppId: string | null
  pendingInstall: MiniAppPreviewResult | null
  fetchApps: () => Promise<void>
  refreshApps: () => Promise<void>
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
  pendingOpenAppId: null,
  pendingInstall: null,
  fetchApps: async () => {
    if (get().loaded) return
    const apps = await window.miniapp.list()
    set({ apps, loaded: true })
  },
  refreshApps: async () => {
    const apps = await window.miniapp.list()
    set({ apps, loaded: true })
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
    await get().refreshApps()
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
    await get().refreshApps()
  },
  requestOpenInCanvas: (appId: string) => set({ pendingOpenAppId: appId }),
  consumePendingOpen: () => {
    const id = get().pendingOpenAppId
    if (id) set({ pendingOpenAppId: null })
    return id
  },
}))
