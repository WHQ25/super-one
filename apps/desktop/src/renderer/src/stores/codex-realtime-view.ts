import { create } from 'zustand'
import type {
  ChatMessage,
  RealtimeTimelineResult,
  RealtimeTimelineSegment,
  RealtimeTranscriptRole,
} from '@superone/shared/agent-types'

export type CodexConversationView = 'thread' | 'realtime'

export interface CodexRealtimeSessionViewState {
  view: CodexConversationView
  segments: RealtimeTimelineSegment[]
  threadMessages: ChatMessage[]
  liveText: { role: RealtimeTranscriptRole; text: string } | null
  realtimeSessionId: string | null
  hasTimeline: boolean
}

export const EMPTY_CODEX_REALTIME_SESSION_VIEW: CodexRealtimeSessionViewState = {
  view: 'thread',
  segments: [],
  threadMessages: [],
  liveText: null,
  realtimeSessionId: null,
  hasTimeline: false,
}

interface CodexRealtimeViewStore {
  sessions: Record<string, CodexRealtimeSessionViewState>
  setView: (sessionId: string, view: CodexConversationView) => void
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

  setTimeline: (sessionId, timeline) => set((state) => {
    const current = sessionState(state.sessions, sessionId)
    const unpublished = current.segments.filter((segment) => (
      segment.id.startsWith('live-')
      && !timeline.segments.some((persisted) => (
        persisted.realtimeSessionId === segment.realtimeSessionId
        && persisted.role === segment.role
        && persisted.text === segment.text
      ))
    ))
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...current,
          segments: [...timeline.segments, ...unpublished],
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
