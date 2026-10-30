import { useCallback, useEffect, useRef, useState } from 'react'

export const SIDEBAR_SECTION_COLLAPSE_KEY = 'superone.sidebar.collapsedSections'

export type SidebarSectionId = 'pinned' | 'drafts' | 'settled'

/** Settled work stays folded until the person opens it. The other groups start open. */
function defaultCollapsed(section: SidebarSectionId): boolean {
  return section === 'settled'
}

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
    if (!raw) return defaultCollapsed(section)
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultCollapsed(section)
    const value = (parsed as Record<string, unknown>)[section]
    return value === undefined ? defaultCollapsed(section) : value === true
  } catch {
    return defaultCollapsed(section)
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

/** One settled group per project, so the id cannot be the shared section id. */
export function settledPanelId(folderPath: string): string {
  return `sidebar-section-settled-${encodeURIComponent(folderPath)}`
}

export const PROJECT_SETTLED_COLLAPSE_KEY = 'superone.sidebar.collapsedSettledProjects'

/** A project's settled group stays folded until its heading is opened. */
export function readProjectSettledCollapsed(store: KeyValueStorage, folderPath: string): boolean {
  try {
    const raw = store.getItem(PROJECT_SETTLED_COLLAPSE_KEY)
    if (!raw) return true
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return true
    const value = (parsed as Record<string, unknown>)[folderPath]
    return value === undefined ? true : value === true
  } catch {
    return true
  }
}

export function writeProjectSettledCollapsed(store: KeyValueStorage, folderPath: string, collapsed: boolean): void {
  let current: Record<string, unknown> = {}
  try {
    const raw = store.getItem(PROJECT_SETTLED_COLLAPSE_KEY)
    const parsed = raw ? JSON.parse(raw) as unknown : {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      current = { ...(parsed as Record<string, unknown>) }
    }
  } catch {
    current = {}
  }
  current[folderPath] = collapsed
  store.setItem(PROJECT_SETTLED_COLLAPSE_KEY, JSON.stringify(current))
}

/**
 * Closing a project forgets that its settled list was open.
 * The next time the project expands, the group starts folded.
 */
export function foldProjectSettled(folderPath: string): void {
  try {
    if (readProjectSettledCollapsed(storage(), folderPath)) return
    writeProjectSettledCollapsed(storage(), folderPath, true)
  } catch {
    // Private mode or a full disk: the next mount still starts folded when unread.
  }
}

/** Saved fold for one project's settled sessions. Missing projects start folded. */
export function useProjectSettledCollapsed(folderPath: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => readProjectSettledCollapsed(storage(), folderPath))
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    try {
      writeProjectSettledCollapsed(storage(), folderPath, collapsed)
    } catch {
      // Private mode or a full disk: the fold still applies for this visit.
    }
  }, [collapsed, folderPath])
  const toggle = useCallback(() => setCollapsed((current) => !current), [])
  return [collapsed, toggle]
}

/** Saved fold for a sidebar group. Pinned and Drafts start open. Settled starts folded. */
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
