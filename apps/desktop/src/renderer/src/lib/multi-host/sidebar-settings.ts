import { DEFAULT_SIDEBAR_SETTINGS, type SidebarGroupBy, type SidebarSettings, type SidebarSort } from './types'

const STORAGE_KEY = 'superone.sidebar.v1'
const MAX_EXPANDED = 200

export interface SidebarSettingsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const memory = new Map<string, string>()

/** Used when `localStorage` is missing (node tests, very early import). */
export function memorySidebarStorage(): SidebarSettingsStorage {
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => { memory.set(key, value) },
  }
}

export function browserSidebarStorage(): SidebarSettingsStorage {
  if (typeof localStorage === 'undefined') return memorySidebarStorage()
  return localStorage
}

function isGroupBy(value: unknown): value is SidebarGroupBy {
  return value === 'project' || value === 'environment'
}

function isSort(value: unknown): value is SidebarSort {
  return value === 'recent' || value === 'added'
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, MAX_EXPANDED)
}

export function parseSidebarSettings(raw: string | null): SidebarSettings {
  if (!raw) return { ...DEFAULT_SIDEBAR_SETTINGS }
  try {
    const parsed = JSON.parse(raw) as Partial<SidebarSettings>
    return {
      groupBy: isGroupBy(parsed.groupBy) ? parsed.groupBy : DEFAULT_SIDEBAR_SETTINGS.groupBy,
      sort: isSort(parsed.sort) ? parsed.sort : DEFAULT_SIDEBAR_SETTINGS.sort,
      expandedProjectKeys: stringList(parsed.expandedProjectKeys),
      collapsedEnvironmentIds: stringList(parsed.collapsedEnvironmentIds),
    }
  } catch {
    return { ...DEFAULT_SIDEBAR_SETTINGS }
  }
}

export function readSidebarSettings(storage: SidebarSettingsStorage): SidebarSettings {
  return parseSidebarSettings(storage.getItem(STORAGE_KEY))
}

export function writeSidebarSettings(storage: SidebarSettingsStorage, settings: SidebarSettings): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({
    groupBy: settings.groupBy,
    sort: settings.sort,
    expandedProjectKeys: settings.expandedProjectKeys.slice(0, MAX_EXPANDED),
    collapsedEnvironmentIds: settings.collapsedEnvironmentIds.slice(0, MAX_EXPANDED),
  }))
}
