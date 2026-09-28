import { create } from 'zustand'
import { withoutKey } from '@/lib/record'
import type { MiniAppSlot } from './miniapp'

/**
 * Picture-in-picture for development mini-app views an agent drives while the
 * Activity panel is closed. The views stay in their host layer; the floating
 * frame only reports where to draw them.
 */

export interface MiniAppPipSlot extends Omit<MiniAppSlot, 'mode'> {
  mode: 'pip'
}

interface HiddenMiniAppPip {
  sessionId: string
  targetId: string
}

interface MiniAppPipState {
  /** Keyed like the host-layer panel slots: instance key, or the preview's slot key. */
  pipSlots: Record<string, MiniAppPipSlot>
  /** Hidden by the user until they restore it or the turn ends. */
  hidden: HiddenMiniAppPip | null
  updatePipSlot: (slotKey: string, rect: DOMRectReadOnly) => void
  unregisterPipSlot: (slotKey: string) => void
  hide: (sessionId: string, targetId: string) => void
  restore: () => void
  clearHidden: (sessionId: string) => void
}

export const useMiniAppPipStore = create<MiniAppPipState>()((set, get) => ({
  pipSlots: {},
  hidden: null,

  updatePipSlot: (slotKey, rect) => {
    const prev = get().pipSlots[slotKey]
    const next: MiniAppPipSlot = {
      mode: 'pip',
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
    if (prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height) return
    set((s) => ({ pipSlots: { ...s.pipSlots, [slotKey]: next } }))
  },

  unregisterPipSlot: (slotKey) => {
    if (!get().pipSlots[slotKey]) return
    set((s) => ({ pipSlots: withoutKey(s.pipSlots, slotKey) }))
  },

  hide: (sessionId, targetId) => set({ hidden: { sessionId, targetId } }),
  restore: () => set({ hidden: null }),
  clearHidden: (sessionId) => set((s) => (s.hidden?.sessionId === sessionId ? { hidden: null } : s)),
}))

export function isMiniAppPipHidden(state: Pick<MiniAppPipState, 'hidden'>, sessionId: string | null, targetId: string | null): boolean {
  return state.hidden != null && state.hidden.sessionId === sessionId && state.hidden.targetId === targetId
}
