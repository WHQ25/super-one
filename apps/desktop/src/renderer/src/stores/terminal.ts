import { create } from 'zustand'
import type { Terminal as XTerm } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import type { WebglAddon } from '@xterm/addon-webgl'
import type { TerminalListItem } from '@superone/shared/agent-types'

export const NO_SESSION_KEY = '__no_session__'

export interface TermInstance {
  xterm: XTerm
  fit: FitAddon
  search: SearchAddon
  webgl?: WebglAddon
  lastSeq: number
  writable: boolean
  chunks: Map<string, { total: number; parts: Map<number, string>; lastSeq?: number }>
}

interface ProjectTerm {
  tabs: TerminalListItem[]
  activeId: string | null
}

interface TerminalStore {
  openBySession: Record<string, boolean>
  byProject: Record<string, ProjectTerm>
  instances: Map<string, TermInstance>
  setOpen: (sessionId: string | null, open: boolean) => void
  toggleOpen: (sessionId: string | null) => void
  addTab: (projectPath: string, item: TerminalListItem) => void
  removeTab: (projectPath: string, terminalId: string) => void
  setActive: (projectPath: string, terminalId: string) => void
  renameTab: (terminalId: string, title: string) => void
  reorderTabs: (projectPath: string, fromId: string, toId: string) => void
}

const sessionKey = (sessionId: string | null): string => sessionId ?? NO_SESSION_KEY

export const EMPTY_TABS: TerminalListItem[] = []

export const useTerminalStore = create<TerminalStore>((set) => ({
  openBySession: {},
  byProject: {},
  instances: new Map(),

  setOpen: (sessionId, open) =>
    set((s) => ({ openBySession: { ...s.openBySession, [sessionKey(sessionId)]: open } })),

  toggleOpen: (sessionId) =>
    set((s) => {
      const key = sessionKey(sessionId)
      return { openBySession: { ...s.openBySession, [key]: !s.openBySession[key] } }
    }),

  addTab: (projectPath, item) =>
    set((s) => {
      const cur = s.byProject[projectPath] ?? { tabs: EMPTY_TABS, activeId: null }
      return {
        byProject: {
          ...s.byProject,
          [projectPath]: { tabs: [...cur.tabs, item], activeId: item.terminalId },
        },
      }
    }),

  removeTab: (projectPath, terminalId) =>
    set((s) => {
      const cur = s.byProject[projectPath]
      if (!cur) return s
      const tabs = cur.tabs.filter((t) => t.terminalId !== terminalId)
      const activeId =
        cur.activeId === terminalId ? (tabs[tabs.length - 1]?.terminalId ?? null) : cur.activeId
      return { byProject: { ...s.byProject, [projectPath]: { tabs, activeId } } }
    }),

  setActive: (projectPath, terminalId) =>
    set((s) => {
      const cur = s.byProject[projectPath]
      if (!cur) return s
      return { byProject: { ...s.byProject, [projectPath]: { ...cur, activeId: terminalId } } }
    }),

  renameTab: (terminalId, title) =>
    set((s) => {
      const trimmed = title.trim()
      for (const [path, pt] of Object.entries(s.byProject)) {
        const idx = pt.tabs.findIndex((t) => t.terminalId === terminalId)
        if (idx === -1) continue
        if (!trimmed || pt.tabs[idx].title === trimmed) return s
        const tabs = pt.tabs.slice()
        tabs[idx] = { ...tabs[idx], title: trimmed }
        return { byProject: { ...s.byProject, [path]: { ...pt, tabs } } }
      }
      return s
    }),

  reorderTabs: (projectPath, fromId, toId) =>
    set((s) => {
      const cur = s.byProject[projectPath]
      if (!cur) return s
      const from = cur.tabs.findIndex((t) => t.terminalId === fromId)
      const to = cur.tabs.findIndex((t) => t.terminalId === toId)
      if (from === -1 || to === -1 || from === to) return s
      const tabs = cur.tabs.slice()
      const [moved] = tabs.splice(from, 1)
      tabs.splice(to, 0, moved)
      return { byProject: { ...s.byProject, [projectPath]: { ...cur, tabs } } }
    }),
}))
