import { create } from 'zustand'
import { shareCatalog } from '@/lib/multi-host/catalog'
import { browserSidebarStorage, readSidebarSettings, writeSidebarSettings } from '@/lib/multi-host/sidebar-settings'
import type { EnvironmentBucket, SidebarGroupBy, SidebarSettings, SidebarSort } from '@/lib/multi-host/types'

interface MultiHostSidebarState {
  settings: SidebarSettings
  environments: EnvironmentBucket[]
  setGroupBy: (groupBy: SidebarGroupBy) => void
  setSort: (sort: SidebarSort) => void
  setExpandedProjectKeys: (keys: string[]) => void
  toggleEnvironmentExpanded: (environmentId: string) => void
  replaceEnvironments: (environments: EnvironmentBucket[]) => void
}

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index])
}

export const useMultiHostSidebarStore = create<MultiHostSidebarState>((set) => ({
  settings: readSidebarSettings(browserSidebarStorage()),
  environments: [],
  setGroupBy: (groupBy) => set((state) => (
    state.settings.groupBy === groupBy ? state : { settings: { ...state.settings, groupBy } }
  )),
  setSort: (sort) => set((state) => (
    state.settings.sort === sort ? state : { settings: { ...state.settings, sort } }
  )),
  setExpandedProjectKeys: (keys) => set((state) => (
    sameKeys(state.settings.expandedProjectKeys, keys)
      ? state
      : { settings: { ...state.settings, expandedProjectKeys: keys } }
  )),
  toggleEnvironmentExpanded: (environmentId) => set((state) => {
    const current = state.settings.collapsedEnvironmentIds
    const collapsedEnvironmentIds = current.includes(environmentId)
      ? current.filter((id) => id !== environmentId)
      : [...current, environmentId]
    return { settings: { ...state.settings, collapsedEnvironmentIds } }
  }),
  replaceEnvironments: (environments) => set((state) => {
    const next = shareCatalog(state.environments, environments)
    return next === state.environments ? state : { environments: next }
  }),
}))

useMultiHostSidebarStore.subscribe((state, previous) => {
  if (state.settings !== previous.settings) writeSidebarSettings(browserSidebarStorage(), state.settings)
})
