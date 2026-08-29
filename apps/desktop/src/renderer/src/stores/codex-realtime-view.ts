import { create } from 'zustand'
import type {
  ChatMessage,
  RealtimeTimelineResult,
  RealtimeTimelineSegment,
  RealtimeTranscriptRole,
} from '@superone/shared/agent-types'
import { mergePendingRealtimeTimelineSegments } from '@superone/shared/realtime-timeline'

export type CodexConversationView = 'thread' | 'realtime'

export interface CodexRealtimeSessionViewState {
  view: CodexConversationView
  loadStatus: 'idle' | 'loading' | 'loaded' | 'error'
  segments: RealtimeTimelineSegment[]
  threadMessages: ChatMessage[]
  liveText: { role: RealtimeTranscriptRole; text: string } | null
  realtimeSessionId: string | null
  hasTimeline: boolean
}

export const EMPTY_CODEX_REALTIME_SESSION_VIEW: CodexRealtimeSessionViewState = {
  view: 'thread',
  loadStatus: 'idle',
  segments: [],
  threadMessages: [],
  liveText: null,
  realtimeSessionId: null,
  hasTimeline: false,
}

interface CodexRealtimeViewStore {
  sessions: Record<string, CodexRealtimeSessionViewState>
  setView: (sessionId: string, view: CodexConversationView) => void
  setTimelineLoading: (sessionId: string) => void
  setTimelineError: (sessionId: string) => void
  setTimeline: (sessionId: string, timeline: RealtimeTimelineResult) => void
  setRealtimeSession: (sessionId: string, realtimeSessionId: string | null) => void
  appendTranscriptDelta: (sessionId: string, role: RealtimeTranscriptRole, text: string) => void
  finalizeTranscript: (sessionId: string, role: RealtimeTranscriptRole, text: string) => void
}

function sessionState(
  sessions: Record<string, CodexRealtimeSessionViewState>,
  sessionId: string,
): CodexRealtimeSessionViewState {
  return sessions[sessionId] ?? EMPTY_CODEX_REALTIME_SESSION_VIEW
}

export const useCodexRealtimeViewStore = create<CodexRealtimeViewStore>((set) => ({
  sessions: {},

  setView: (sessionId, view) => set((state) => {
    const current = sessionState(state.sessions, sessionId)
    if (current.view === view) return state
    return { sessions: { ...state.sessions, [sessionId]: { ...current, view } } }
  }),

  setTimelineLoading: (sessionId) => set((state) => {
    const current = sessionState(state.sessions, sessionId)
    if (current.loadStatus === 'loading') return state
    return { sessions: { ...state.sessions, [sessionId]: { ...current, loadStatus: 'loading' } } }
  }),

  setTimelineError: (sessionId) => set((state) => {
    const current = sessionState(state.sessions, sessionId)
    return { sessions: { ...state.sessions, [sessionId]: { ...current, loadStatus: 'error' } } }
  }),

  setTimeline: (sessionId, timeline) => set((state) => {
    const current = sessionState(state.sessions, sessionId)
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...current,
          loadStatus: 'loaded',
          segments: mergePendingRealtimeTimelineSegments(
            timeline.segments,
            current.segments,
            ['live-'],
          ),
          threadMessages: timeline.threadMessages,
          realtimeSessionId: timeline.activeRealtimeSessionId ?? current.realtimeSessionId,
          hasTimeline: timeline.hasTimeline || current.hasTimeline,
        },
      },
    }
  }),

  setRealtimeSession: (sessionId, realtimeSessionId) => set((state) => {
    const current = sessionState(state.sessions, sessionId)
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...current,
          realtimeSessionId,
          hasTimeline: current.hasTimeline || realtimeSessionId !== null,
          ...(realtimeSessionId === null ? { liveText: null } : {}),
        },
      },
    }
  }),

  appendTranscriptDelta: (sessionId, role, text) => set((state) => {
    const current = sessionState(state.sessions, sessionId)
    const liveText = current.liveText?.role === role
      ? { role, text: `${current.liveText.text}${text}` }
      : { role, text }
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: { ...current, liveText },
      },
    }
  }),

  finalizeTranscript: (sessionId, role, text) => set((state) => {
    const current = sessionState(state.sessions, sessionId)
    const realtimeSessionId = current.realtimeSessionId ?? 'live'
    const segment: RealtimeTimelineSegment = {
      id: `live-${realtimeSessionId}-${current.segments.length}`,
      realtimeSessionId,
      role,
      text,
    }
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...current,
          segments: [...current.segments, segment],
          liveText: null,
          hasTimeline: true,
        },
      },
    }
  }),
}))

const timelineHydrations = new Map<string, Promise<void>>()

function applyTimeline(sessionId: string, timeline: RealtimeTimelineResult): void {
  const store = useCodexRealtimeViewStore.getState()
  store.setTimeline(sessionId, timeline)
  if (timeline.threadMessages.length === 0 && timeline.segments.length > 0) {
    store.setView(sessionId, 'realtime')
  }
}

/** Load the local snapshot first, then reconcile it with Codex in the background. */
export function hydrateCodexRealtimeTimeline(projectPath: string, sessionId: string): Promise<void> {
  const existing = timelineHydrations.get(sessionId)
  if (existing) return existing

  useCodexRealtimeViewStore.getState().setTimelineLoading(sessionId)
  let restoredLocal = false
  const hydration = (async () => {
    try {
      const local = await window.agent.loadRealtimeTimeline(sessionId)
      if (local) {
        restoredLocal = true
        applyTimeline(sessionId, local)
      }
    } catch {
      // A missing/corrupt local snapshot falls through to the provider copy.
    }

    try {
      applyTimeline(sessionId, await window.agent.getRealtimeTimeline(projectPath, sessionId))
    } catch {
      if (!restoredLocal) useCodexRealtimeViewStore.getState().setTimelineError(sessionId)
    }
  })().finally(() => {
    timelineHydrations.delete(sessionId)
  })
  timelineHydrations.set(sessionId, hydration)
  return hydration
}

export async function refreshCodexRealtimeTimeline(projectPath: string, sessionId: string): Promise<void> {
  applyTimeline(sessionId, await window.agent.getRealtimeTimeline(projectPath, sessionId))
}
