import { useCallback, useEffect, useRef, useState } from 'react'

export const SIDEBAR_SECTION_COLLAPSE_KEY = 'superone.sidebar.collapsedSections'

export type SidebarSectionId = 'pinned' | 'drafts'

interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function storage(): KeyValueStorage {
  if (typeof localStorage === 'undefined') {
    return { getItem: () => null, setItem: () => {} }
  }
  return localStorage
}

export function readCollapsedSection(store: KeyValueStorage, section: SidebarSectionId): boolean {
  try {
    const raw = store.getItem(SIDEBAR_SECTION_COLLAPSE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    return (parsed as Record<string, unknown>)[section] === true
  } catch {
    return false
  }
}

export function writeCollapsedSection(store: KeyValueStorage, section: SidebarSectionId, collapsed: boolean): void {
  let current: Record<string, unknown> = {}
  try {
    const raw = store.getItem(SIDEBAR_SECTION_COLLAPSE_KEY)
    const parsed = raw ? JSON.parse(raw) as unknown : {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      current = { ...(parsed as Record<string, unknown>) }
    }
  } catch {
    current = {}
  }
  current[section] = collapsed
  store.setItem(SIDEBAR_SECTION_COLLAPSE_KEY, JSON.stringify(current))
}

export function sidebarSectionPanelId(section: SidebarSectionId): string {
  return `sidebar-section-${section}`
}

/** Saved fold for a sidebar group. Default is open; the choice survives reloads. */
export function useSidebarSectionCollapsed(section: SidebarSectionId): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => readCollapsedSection(storage(), section))
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    try {
      writeCollapsedSection(storage(), section, collapsed)
    } catch {
      // Private mode or a full disk: the fold still applies for this visit.
    }
  }, [collapsed, section])
  const toggle = useCallback(() => setCollapsed((current) => !current), [])
  return [collapsed, toggle]
}
