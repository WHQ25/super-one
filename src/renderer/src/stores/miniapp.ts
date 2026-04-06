import { create } from 'zustand'
import type { MiniAppEntry, MiniAppInstallResult } from '../../../shared/miniapp-types'

interface MiniAppStoreState {
  apps: MiniAppEntry[]
  loaded: boolean
  pendingOpenAppId: string | null
  fetchApps: () => Promise<void>
  refreshApps: () => Promise<void>
  installApp: (s1appPath: string) => Promise<MiniAppInstallResult>
  uninstallApp: (appId: string) => Promise<void>
  requestOpenInCanvas: (appId: string) => void
  consumePendingOpen: () => string | null
}

export const useMiniAppStore = create<MiniAppStoreState>((set, get) => ({
  apps: [],
  loaded: false,
  pendingOpenAppId: null,
  fetchApps: async () => {
    if (get().loaded) return
    const apps = await window.miniapp.list()
    set({ apps, loaded: true })
  },
  refreshApps: async () => {
    const apps = await window.miniapp.list()
    set({ apps, loaded: true })
  },
  installApp: async (s1appPath: string) => {
    const result = await window.miniapp.install(s1appPath)
    await get().refreshApps()
    return result
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
