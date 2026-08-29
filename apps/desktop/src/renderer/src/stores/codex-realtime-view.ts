import { create } from 'zustand'
import type {
  ChatMessage,
  RealtimeTimelineResult,
  RealtimeTimelineSegment,
  RealtimeTranscriptRole,
} from '@superone/shared/agent-types'
import { mergePendingRealtimeTimelineSegments } from '@superone/shared/realtime-timeline'

export type CodexConversationView = 'thread' | 'realtime'

/**
 * One transcript item of the running call. Codex opens a separate item per speaker
 * the moment they start, so the two roles stream into two buffers and the array
 * order is the order speech began — not the order transcription happened to finish.
 */
export interface CodexRealtimeLiveItem {
  itemId: string
  realtimeSessionId: string
  role: RealtimeTranscriptRole
  text: string
  done: boolean
  /** Epoch ms of when this speaker opened the item; absent if the view mounted mid-item. */
  startedAtMs?: number
}

export interface CodexRealtimeSessionViewState {
  view: CodexConversationView
  loadStatus: 'idle' | 'loading' | 'loaded' | 'error'
  segments: RealtimeTimelineSegment[]
  threadMessages: ChatMessage[]
  liveItems: CodexRealtimeLiveItem[]
  realtimeSessionId: string | null
  realtimeSessionSource: 'timeline' | 'event'
  hasTimeline: boolean
  /**
   * The user asked for a call and the SDP round trip has not answered yet. The view
   * must switch on the click, not on `realtime_started` — waiting means the empty-pane
   * chrome keeps rendering for the length of the negotiation, and its three mutually
   * exclusive branches remount the harness picker on the way through.
   */
  starting: boolean
}

export const EMPTY_CODEX_REALTIME_SESSION_VIEW: CodexRealtimeSessionViewState = {
  view: 'thread',
  loadStatus: 'idle',
  segments: [],
  threadMessages: [],
  liveItems: [],
  realtimeSessionId: null,
  realtimeSessionSource: 'timeline',
  hasTimeline: false,
  starting: false,
}

export type CodexRealtimeTranscriptItem = Omit<CodexRealtimeLiveItem, 'done'>

interface CodexRealtimeViewStore {
  sessions: Record<string, CodexRealtimeSessionViewState>
  setView: (sessionId: string, view: CodexConversationView) => void
  setTimelineLoading: (sessionId: string) => void
  setTimelineError: (sessionId: string) => void
  setTimeline: (sessionId: string, timeline: RealtimeTimelineResult) => void
  setRealtimeSession: (sessionId: string, realtimeSessionId: string | null) => void
  setRealtimeStarting: (sessionId: string, starting: boolean) => void
  startTranscriptItem: (sessionId: string, item: CodexRealtimeTranscriptItem) => void
  appendTranscriptItemDelta: (sessionId: string, itemId: string, text: string) => void
  completeTranscriptItem: (sessionId: string, item: CodexRealtimeTranscriptItem) => void
}

function sessionState(
  sessions: Record<string, CodexRealtimeSessionViewState>,
  sessionId: string,
): CodexRealtimeSessionViewState {
  return sessions[sessionId] ?? EMPTY_CODEX_REALTIME_SESSION_VIEW
}

/** Marks a segment this view committed before the provider timeline published it. */
const LIVE_SEGMENT_ID_PREFIX = 'live-'

export function liveItemToSegment(item: CodexRealtimeLiveItem): RealtimeTimelineSegment {
  return {
    id: `${LIVE_SEGMENT_ID_PREFIX}${item.itemId}`,
    sourceItemId: item.itemId,
    realtimeSessionId: item.realtimeSessionId,
    role: item.role,
    text: item.text,
    ...(item.startedAtMs === undefined ? {} : { startedAtMs: item.startedAtMs }),
  }
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
    // A timeline already on screen must keep rendering while it revalidates. Flipping
    // a loaded session back to `loading` blanks the transcript for as long as the
    // refresh takes — visible as a flash every time the realtime view is mounted,
    // since mounting is itself what triggers the refresh.
    if (current.loadStatus === 'loaded') return state
    return { sessions: { ...state.sessions, [sessionId]: { ...current, loadStatus: 'loading' } } }
  }),

  setTimelineError: (sessionId) => set((state) => {
    const current = sessionState(state.sessions, sessionId)
    return { sessions: { ...state.sessions, [sessionId]: { ...current, loadStatus: 'error' } } }
  }),

  setTimeline: (sessionId, timeline) => set((state) => {
    const current = sessionState(state.sessions, sessionId)
    const segments = mergePendingRealtimeTimelineSegments(
      timeline.segments,
      current.segments,
      [LIVE_SEGMENT_ID_PREFIX],
    )
    // A live item stays in the buffer until a snapshot carries the same transcript,
    // so a call whose refresh has not landed yet keeps rendering its own transcript
    // instead of blanking.
    const published = new Set(segments.map((segment) => segment.sourceItemId ?? segment.id))
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...current,
          loadStatus: 'loaded',
          segments,
          liveItems: current.liveItems.filter((item) => !published.has(item.itemId)),
          threadMessages: timeline.threadMessages,
          // Once this renderer observes a realtime lifecycle event, that event is
          // authoritative. A timeline request may have started before the call
          // started or closed, so its active id can be stale in either direction.
          realtimeSessionId: current.realtimeSessionSource === 'event'
            ? current.realtimeSessionId
            : timeline.activeRealtimeSessionId,
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
          realtimeSessionSource: 'event',
          starting: false,
          hasTimeline: current.hasTimeline || realtimeSessionId !== null,
        },
      },
    }
  }),

  setRealtimeStarting: (sessionId, starting) => set((state) => {
    const current = sessionState(state.sessions, sessionId)
    if (current.starting === starting) return state
    return { sessions: { ...state.sessions, [sessionId]: { ...current, starting } } }
  }),

  startTranscriptItem: (sessionId, item) => set((state) => {
    const current = sessionState(state.sessions, sessionId)
    if (current.liveItems.some((live) => live.itemId === item.itemId)) return state
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...current,
          liveItems: [...current.liveItems, { ...item, done: false }],
          hasTimeline: true,
        },
      },
    }
  }),

  appendTranscriptItemDelta: (sessionId, itemId, text) => set((state) => {
    const current = sessionState(state.sessions, sessionId)
    if (!current.liveItems.some((live) => live.itemId === itemId)) return state
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...current,
          liveItems: current.liveItems.map((live) => (
            live.itemId === itemId ? { ...live, text: `${live.text}${text}` } : live
          )),
        },
      },
    }
  }),

  completeTranscriptItem: (sessionId, item) => set((state) => {
    const current = sessionState(state.sessions, sessionId)
    // Codex sends the canonical text on completion; it may differ from the
    // concatenated deltas, so replace rather than keep what streamed. An item the
    // view never saw start (mounted mid-call) is appended in completion order.
    const known = current.liveItems.some((live) => live.itemId === item.itemId)
    const liveItems = known
      ? current.liveItems.map((live) => (
        // The completion may arrive without a stamp; the one taken when the item
        // opened is the earlier and more accurate of the two, so it wins.
        live.itemId === item.itemId
          ? { ...live, ...item, startedAtMs: live.startedAtMs ?? item.startedAtMs, done: true }
          : live
      ))
      : [...current.liveItems, { ...item, done: true }]
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: { ...current, liveItems, hasTimeline: true },
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
