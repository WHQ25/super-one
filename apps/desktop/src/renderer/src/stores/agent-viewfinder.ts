/**
 * The one agent-operated target shown in each session's floating viewfinder.
 *
 * Recency belongs to a session, not to the renderer: background sessions continue
 * receiving tool events while another conversation is on screen. Target identity is
 * part of the winner too, so a newly-opened tab never falls back to an older ready tab.
 */

import { create } from 'zustand'

export type ViewfinderKind = 'device' | 'browser' | 'computer'

export interface ViewfinderTarget {
  kind: ViewfinderKind
  /** Browser id, device id, or native window id. Null until a tool resolves it. */
  targetId: string | null
}

interface AgentViewfinderState {
  activeBySession: Record<string, ViewfinderTarget | null>
  activate: (sessionId: string, kind: ViewfinderKind, targetId?: string | null) => void
  clear: (sessionId: string, expected?: Partial<ViewfinderTarget>) => void
}

export const useAgentViewfinderStore = create<AgentViewfinderState>()((set) => ({
  activeBySession: {},

  activate: (sessionId, kind, targetId = null) => {
    if (!sessionId) return
    set((state) => {
      const current = state.activeBySession[sessionId]
      if (current && current.kind === kind && current.targetId === targetId) return state
      return {
        activeBySession: {
          ...state.activeBySession,
          [sessionId]: { kind, targetId },
        },
      }
    })
  },

  clear: (sessionId, expected) => set((state) => {
    const current = state.activeBySession[sessionId]
    if (!current) return state
    if (expected?.kind && current.kind !== expected.kind) return state
    if (expected?.targetId != null && current.targetId !== expected.targetId) return state
    return {
      activeBySession: {
        ...state.activeBySession,
        [sessionId]: null,
      },
    }
  }),
}))

export function selectViewfinderTarget(
  state: AgentViewfinderState,
  sessionId: string | null | undefined,
): ViewfinderTarget | null {
  return sessionId ? state.activeBySession[sessionId] ?? null : null
}

/** Map agent-facing tools to the viewfinder target they actively operate. */
export function viewfinderKindForToolName(toolName: string): ViewfinderKind | null {
  const leaf = toolName.toLowerCase().split('__').at(-1) ?? ''
  if (leaf.startsWith('browser_')
    && leaf !== 'browser_action_list'
    && leaf !== 'browser_action_save'
    && leaf !== 'browser_tabs'
    && leaf !== 'browser_list_downloads') return 'browser'
  if (/^computer_(snapshot|zoom|query|act|wait_for)$/.test(leaf)) return 'computer'
  if (/^device_(request_control|snapshot|query|act|wait_for)$/.test(leaf)) return 'device'
  return null
}

/** Whether this subsystem may draw the preview right now. */
export function useOwnsViewfinder(
  kind: ViewfinderKind,
  sessionId: string | null | undefined,
  targetId?: string | null,
): boolean {
  return useAgentViewfinderStore((state) => {
    const active = selectViewfinderTarget(state, sessionId)
    if (active?.kind !== kind) return false
    return active.targetId == null || targetId == null || active.targetId === targetId
  })
}
