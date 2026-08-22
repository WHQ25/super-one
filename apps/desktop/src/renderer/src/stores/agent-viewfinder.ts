/**
 * One floating preview, shared by everything the agent can be watching.
 *
 * Three subsystems can put a picture-in-picture on screen — a device, a browser tab,
 * and Computer Use's native window — and until now each decided on its own. Two of
 * them showing at once is not two useful views: they are separately draggable boxes
 * over the same chat, at different z-layers, and the user has to move one to read the
 * other. Worse, neither says which one the agent is actually acting on, which is the
 * only question the preview exists to answer.
 *
 * So the preview is a single VIEWFINDER: it shows the one target the agent touched
 * most recently. Each subsystem reports whether it has something to show; this picks
 * the winner and the losers stand down.
 *
 * A user pin beats recency. Deliberately putting a target on screen — expanding it,
 * or shrinking it back rather than dismissing it — says "keep showing me this", and
 * an agent that then touches something else must not yank it away. Recency is the
 * default precisely because it is what you want when you have expressed no preference.
 *
 * Computer Use's PiP is a native macOS window, so it cannot be positioned or stacked
 * by this layer; it participates by being told to stand down. See
 * `useAgentViewfinder`.
 */

import { create } from 'zustand'

export type ViewfinderKind = 'device' | 'browser' | 'computer'

const KINDS: readonly ViewfinderKind[] = ['device', 'browser', 'computer']

interface ViewfinderClaim {
  /** Something to show right now. */
  present: boolean
  /** The user put it there by hand. Beats recency until they let it go. */
  pinned: boolean
  /**
   * Arrival order, not a clock.
   *
   * Only the comparison matters, and a counter cannot go backwards the way a wall
   * clock can — two claims a millisecond apart still order correctly.
   */
  seq: number
}

const IDLE: ViewfinderClaim = { present: false, pinned: false, seq: 0 }

interface AgentViewfinderState {
  claims: Record<ViewfinderKind, ViewfinderClaim>
  /**
   * Say what this subsystem has to show. Idempotent — every caller reports on every
   * render, and an unchanged report must not re-order the winner.
   */
  report: (kind: ViewfinderKind, next: { present: boolean; pinned?: boolean }) => void
}

let counter = 0

export const useAgentViewfinderStore = create<AgentViewfinderState>()((set) => ({
  claims: { device: IDLE, browser: IDLE, computer: IDLE },

  report: (kind, next) => set((state) => {
    const current = state.claims[kind]
    const pinned = next.pinned ?? false
    if (current.present === next.present && current.pinned === pinned) return state
    // A fresh sequence for arriving, and for being pinned: both are new intent about
    // this target. Losing the pin is not — a target that stays on screen unpinned
    // keeps the place in the order it already had.
    const arriving = (next.present && !current.present) || (pinned && !current.pinned)
    return {
      claims: {
        ...state.claims,
        [kind]: { present: next.present, pinned, seq: arriving ? ++counter : current.seq },
      },
    }
  }),
}))

/** Which subsystem owns the preview, or null when nothing is asking for it. */
export function selectViewfinderOwner(state: AgentViewfinderState): ViewfinderKind | null {
  let best: ViewfinderKind | null = null
  for (const kind of KINDS) {
    const claim = state.claims[kind]
    if (!claim.present) continue
    if (!best) { best = kind; continue }
    const incumbent = state.claims[best]
    if (claim.pinned !== incumbent.pinned) {
      if (claim.pinned) best = kind
      continue
    }
    if (claim.seq > incumbent.seq) best = kind
  }
  return best
}

/** Whether this subsystem may draw the preview right now. */
export function useOwnsViewfinder(kind: ViewfinderKind): boolean {
  return useAgentViewfinderStore((state) => selectViewfinderOwner(state) === kind)
}
