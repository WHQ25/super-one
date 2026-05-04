import { create } from 'zustand'
import type { MiniAppMediaKind } from '../../../shared/miniapp-types'

export type MediaCounts = Partial<Record<MiniAppMediaKind, number>>

interface MediaStoreState {
  active: Record<string, MediaCounts>
  start: (appId: string, kinds: MiniAppMediaKind[]) => void
  endTrack: (appId: string, kind: MiniAppMediaKind) => void
  clearApp: (appId: string) => void
}

export const useMiniAppMediaStore = create<MediaStoreState>((set) => ({
  active: {},
  start: (appId, kinds) => set((s) => {
    const existing = s.active[appId] ?? {}
    const next: MediaCounts = { ...existing }
    for (const k of kinds) {
      next[k] = (next[k] ?? 0) + 1
    }
    return { active: { ...s.active, [appId]: next } }
  }),
  endTrack: (appId, kind) => set((s) => {
    const existing = s.active[appId]
    if (!existing) return s
    const cur = existing[kind] ?? 0
    if (cur <= 1) {
      const rest: MediaCounts = {}
      for (const k of Object.keys(existing) as MiniAppMediaKind[]) {
        if (k !== kind) rest[k] = existing[k]
      }
      const nextActive = { ...s.active }
      if (Object.keys(rest).length === 0) delete nextActive[appId]
      else nextActive[appId] = rest
      return { active: nextActive }
    }
    return { active: { ...s.active, [appId]: { ...existing, [kind]: cur - 1 } } }
  }),
  clearApp: (appId) => set((s) => {
    if (!s.active[appId]) return s
    const nextActive: Record<string, MediaCounts> = {}
    for (const id of Object.keys(s.active)) {
      if (id !== appId) nextActive[id] = s.active[id]
    }
    return { active: nextActive }
  }),
}))
