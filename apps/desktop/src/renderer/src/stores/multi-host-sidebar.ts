import { create } from 'zustand'
import { beginSessionLoad, commitSessionPage, failSessionPage } from '@/lib/multi-host/session-pages'
import { browserSidebarStorage, readSidebarSettings, writeSidebarSettings } from '@/lib/multi-host/sidebar-settings'
import type { EnvironmentBucket, SessionPageState, SidebarGroupBy, SidebarSettings, SidebarSort } from '@/lib/multi-host/types'

interface MultiHostSidebarState {
  settings: SidebarSettings
  environments: EnvironmentBucket[]
  /** Keyed by `environmentId:projectId`. */
  sessionPages: Record<string, SessionPageState>
  setGroupBy: (groupBy: SidebarGroupBy) => void
  setSort: (sort: SidebarSort) => void
  setExpandedProjectKeys: (keys: string[]) => void
  toggleEnvironmentExpanded: (environmentId: string) => void
  replaceEnvironments: (environments: EnvironmentBucket[]) => void
  beginSessions: (key: string) => void
  commitSessions: (key: string, sessions: Array<{ sessionId: string }>, hasMore: boolean, append: boolean) => void
  failSessions: (key: string, error: string) => void
}

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index])
}

export const useMultiHostSidebarStore = create<MultiHostSidebarState>((set) => ({
  settings: readSidebarSettings(browserSidebarStorage()),
  environments: [],
  sessionPages: {},
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
    const current = state.settings.expandedEnvironmentIds
    const expandedEnvironmentIds = current.includes(environmentId)
      ? current.filter((id) => id !== environmentId)
      : [...current, environmentId]
    return { settings: { ...state.settings, expandedEnvironmentIds } }
  }),
  replaceEnvironments: (environments) => set({ environments }),
  beginSessions: (key) => set((state) => ({
    sessionPages: { ...state.sessionPages, [key]: beginSessionLoad(state.sessionPages[key]) },
  })),
  commitSessions: (key, sessions, hasMore, append) => set((state) => {
    const page = state.sessionPages[key] ?? beginSessionLoad(undefined)
    return { sessionPages: { ...state.sessionPages, [key]: commitSessionPage(page, sessions, hasMore, append) } }
  }),
  failSessions: (key, error) => set((state) => ({
    sessionPages: { ...state.sessionPages, [key]: failSessionPage(state.sessionPages[key], error) },
  })),
}))

useMultiHostSidebarStore.subscribe((state, previous) => {
  if (state.settings !== previous.settings) writeSidebarSettings(browserSidebarStorage(), state.settings)
})
