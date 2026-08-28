import type {
  ComputerUseViewfinderClaim,
  ComputerUseViewfinderFrame,
} from '@superone/shared/agent-types'
import { create } from 'zustand'

interface ComputerViewfinderState {
  targets: Record<string, ComputerUseViewfinderClaim>
  frames: Record<string, ComputerUseViewfinderFrame>
  hiddenSessions: Record<string, boolean>
  applyClaim: (claim: ComputerUseViewfinderClaim) => void
  applyFrame: (frame: ComputerUseViewfinderFrame) => void
  hide: (sessionId: string) => void
  show: (sessionId: string) => void
  reset: () => void
}

function sameTarget(target: ComputerUseViewfinderClaim | undefined, claim: ComputerUseViewfinderClaim): boolean {
  return target?.sessionId === claim.sessionId && target.windowId === claim.windowId
}

export const useComputerViewfinderStore = create<ComputerViewfinderState>()((set) => ({
  targets: {},
  frames: {},
  hiddenSessions: {},

  applyClaim: (claim) => set((state) => {
    if (!claim.active) {
      if (!claim.sessionId) return { targets: {}, frames: {}, hiddenSessions: {} }
      const { [claim.sessionId]: _target, ...targets } = state.targets
      const { [claim.sessionId]: _frame, ...frames } = state.frames
      const { [claim.sessionId]: _hidden, ...hiddenSessions } = state.hiddenSessions
      return { targets, frames, hiddenSessions }
    }
    const same = sameTarget(state.targets[claim.sessionId], claim)
    return {
      targets: { ...state.targets, [claim.sessionId]: claim },
      frames: same ? state.frames : Object.fromEntries(
        Object.entries(state.frames).filter(([sessionId]) => sessionId !== claim.sessionId),
      ),
      hiddenSessions: same
        ? state.hiddenSessions
        : { ...state.hiddenSessions, [claim.sessionId]: false },
    }
  }),

  applyFrame: (frame) => set((state) => {
    const target = state.targets[frame.sessionId]
    if (!target?.active || target.windowId !== frame.windowId) return state
    return { frames: { ...state.frames, [frame.sessionId]: frame } }
  }),

  hide: (sessionId) => set((state) => ({
    hiddenSessions: { ...state.hiddenSessions, [sessionId]: true },
  })),
  show: (sessionId) => set((state) => {
    const { [sessionId]: _hidden, ...hiddenSessions } = state.hiddenSessions
    return { hiddenSessions }
  }),
  reset: () => set({ targets: {}, frames: {}, hiddenSessions: {} }),
}))
