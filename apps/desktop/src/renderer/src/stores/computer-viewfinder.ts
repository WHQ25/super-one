import type {
  ComputerUseViewfinderClaim,
  ComputerUseViewfinderFrame,
} from '@superone/shared/agent-types'
import { create } from 'zustand'

interface ComputerViewfinderState {
  targets: Record<string, ComputerUseViewfinderClaim>
  frames: Record<string, ComputerUseViewfinderFrame>
  /**
   * Newest frame that arrived before its claim. The helper starts the capture
   * inside `pip_show_target`, so the first JPEGs reach the renderer before the
   * claim that would let `applyFrame` accept them. Dropping those leaves the
   * black plate up until another frame happens to arrive later.
   */
  pendingFrames: Record<string, ComputerUseViewfinderFrame>
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

function withoutSession<T>(records: Record<string, T>, sessionId: string): Record<string, T> {
  if (!(sessionId in records)) return records
  const { [sessionId]: _removed, ...rest } = records
  return rest
}

export const useComputerViewfinderStore = create<ComputerViewfinderState>()((set) => ({
  targets: {},
  frames: {},
  pendingFrames: {},
  hiddenSessions: {},

  applyClaim: (claim) => set((state) => {
    if (!claim.active) {
      if (!claim.sessionId) return { targets: {}, frames: {}, pendingFrames: {}, hiddenSessions: {} }
      return {
        targets: withoutSession(state.targets, claim.sessionId),
        frames: withoutSession(state.frames, claim.sessionId),
        pendingFrames: withoutSession(state.pendingFrames, claim.sessionId),
        hiddenSessions: withoutSession(state.hiddenSessions, claim.sessionId),
      }
    }
    const same = sameTarget(state.targets[claim.sessionId], claim)
    const pending = state.pendingFrames[claim.sessionId]
    const pendingMatches = pending?.windowId === claim.windowId
    const current = state.frames[claim.sessionId]
    let frames = state.frames
    if (!same) {
      frames = withoutSession(state.frames, claim.sessionId)
      if (pendingMatches) frames = { ...frames, [claim.sessionId]: pending }
    } else if (pendingMatches && !current) {
      frames = { ...state.frames, [claim.sessionId]: pending }
    }
    return {
      targets: { ...state.targets, [claim.sessionId]: claim },
      frames,
      pendingFrames: withoutSession(state.pendingFrames, claim.sessionId),
      hiddenSessions: same
        ? state.hiddenSessions
        : { ...state.hiddenSessions, [claim.sessionId]: false },
    }
  }),

  applyFrame: (frame) => set((state) => {
    const target = state.targets[frame.sessionId]
    if (!target?.active || target.windowId !== frame.windowId) {
      // A live target for a different window must not be replaced by a stale stream.
      if (target?.active) return state
      return {
        pendingFrames: { ...state.pendingFrames, [frame.sessionId]: frame },
      }
    }
    return {
      frames: { ...state.frames, [frame.sessionId]: frame },
      pendingFrames: withoutSession(state.pendingFrames, frame.sessionId),
    }
  }),

  hide: (sessionId) => set((state) => ({
    hiddenSessions: { ...state.hiddenSessions, [sessionId]: true },
  })),
  show: (sessionId) => set((state) => {
    const { [sessionId]: _hidden, ...hiddenSessions } = state.hiddenSessions
    return { hiddenSessions }
  }),
  reset: () => set({ targets: {}, frames: {}, pendingFrames: {}, hiddenSessions: {} }),
}))
