import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { WebView } from 'react-native-webview'
import type { HostOutbound } from '@superone/chat-view'
import type { ChatMessage } from '@superone/shared/agent-types'
import { isRealtimeVoiceMessage } from '@superone/shared/realtime-transcript'
import { projectRealtimeTranscript } from '@superone/shared/realtime-transcript-projection'
import { mergeCodexThreadMessages } from '@superone/shared/realtime-thread-messages'
import type { ChatRuntime } from '../runtime'
import { injectHostMessage } from '../native-actions'
import { TranscriptDelivery, type TranscriptSnapshot } from '../transcript-delivery'
import type { MobileVoiceState } from '../voice/voice-service'

type ConversationView = 'realtime' | 'thread'
type Facts = Omit<TranscriptSnapshot, 'messages'>

function keepUnchangedSpeech(previous: ChatMessage[], next: ChatMessage[]): ChatMessage[] {
  const prior = new Map(previous.filter(isRealtimeVoiceMessage).map(row => [row.id, row]))
  return next.map(row => {
    const old = prior.get(row.id)
    // A growing caption must not resend every completed utterance over the bridge.
    return old && row.status === old.status && row.role === old.role
      && JSON.stringify(row.content) === JSON.stringify(old.content)
      && JSON.stringify(row.metadata) === JSON.stringify(old.metadata) ? old : row
  })
}

/** Native owns view selection and reduction; the document only paints the chosen history. */
export function useTranscriptSync(web: RefObject<WebView | null>, voice?: MobileVoiceState) {
  const voiceRef = useRef(voice)
  voiceRef.current = voice
  const lastReceipt = useRef<{ channelId: string; sequence: number } | null>(null)
  const delivery = useMemo(() => {
    const channel = new TranscriptDelivery(message => {
      if ('delivery' in message && message.delivery) lastReceipt.current = message.delivery
      if (!web.current) { channel.dispose(); return }
      injectHostMessage(web, message)
    })
    return channel
  }, [web])
  const activeRuntime = useRef<ChatRuntime | null>(null)
  const lastFacts = useRef<Facts>({})
  const previousSpeech = useRef<ChatMessage[]>([])
  const threadCache = useRef<{ messages: ChatMessage[]; canonical: ChatMessage[]; merged: ChatMessage[] } | null>(null)
  const views = useRef(new Map<string, ConversationView>())
  const viewRef = useRef<ConversationView>('realtime')
  const [view, updateView] = useState<ConversationView>('realtime')
  const [hasTimeline, updateHasTimeline] = useState(false)
  const pendingJump = useRef<string | null>(null)
  const jumpReceipt = useRef<{ channelId: string; sequence: number } | null>(null)
  useEffect(() => () => delivery.dispose(), [delivery])

  const paint = (runtime: ChatRuntime, facts: Facts, hydrate = false) => {
    const changed = activeRuntime.current !== runtime
    if (changed) {
      previousSpeech.current = []
      threadCache.current = null
      pendingJump.current = null
      jumpReceipt.current = null
      lastFacts.current = {}
      viewRef.current = views.current.get(runtime.sessionId) ?? 'realtime'
      updateView(viewRef.current)
    }
    activeRuntime.current = runtime
    lastFacts.current = { ...lastFacts.current, ...facts }
    const session = runtime.session
    const timeline = session.realtimeHasTimeline || session.realtimeSegments.length > 0 || session.realtimeLiveSegments.length > 0 || session.realtimeSessionId !== null
    updateHasTimeline(timeline)
    const call = voiceRef.current
    const ownsCall = !!call?.target && call.target.sessionId === runtime.sessionId && call.target.projectPath === runtime.projectPath && call.phase !== 'idle'
    const showingVoice = (timeline || ownsCall) && viewRef.current === 'realtime'
    const emptyState = showingVoice ? ownsCall && call.phase === 'starting' ? 'voice-starting'
      : ownsCall && call.phase === 'active' ? 'voice-ready'
      : ownsCall && call.phase === 'stopping' ? 'voice-stopping' : 'voice-empty'
      : timeline || ownsCall ? 'codex' : null
    if (threadCache.current?.messages !== session.messages || threadCache.current.canonical !== session.realtimeThreadMessages) {
      threadCache.current = { messages: session.messages, canonical: session.realtimeThreadMessages,
        merged: mergeCodexThreadMessages(session.messages, { threadMessages: session.realtimeThreadMessages }, { keepDelegationPrompts: true }) }
    }
    const threadMessages = timeline ? threadCache.current.merged : session.messages
    const projected = showingVoice ? projectRealtimeTranscript({
      messages: threadMessages, segments: session.realtimeSegments, liveSegments: session.realtimeLiveSegments,
      sessionStatus: session.status,
      needsDecision: !!(session.pendingPermissions.length || session.pendingQuestion || session.pendingPlanApproval),
    }) : null
    const messages = projected ? keepUnchangedSpeech(previousSpeech.current, projected.messages) : threadMessages
    if (projected) previousSpeech.current = messages
    delivery.publish({ ...lastFacts.current, messages,
      emptyState, conversationView: showingVoice ? 'realtime' : 'thread', realtimeActivities: projected?.activities ?? [],
      ...(showingVoice ? { hasMoreHistory: false, historyNavigation: false, queuedMessages: [], pendingTurn: null,
        isCompacting: false, compactError: null, isRecapping: false, apiRetry: null } : {}),
    }, hydrate || changed)
  }
  const setView = (next: ConversationView, jump?: string) => {
    const runtime = activeRuntime.current
    viewRef.current = next
    updateView(next)
    if (!runtime) return
    views.current.set(runtime.sessionId, next)
    pendingJump.current = jump ?? null
    jumpReceipt.current = null
    paint(runtime, lastFacts.current, true)
    if (pendingJump.current) jumpReceipt.current = lastReceipt.current
  }
  // Media readiness is independent of transcript events: repaint its empty hint directly.
  useEffect(() => {
    const runtime = activeRuntime.current
    if (runtime) paint(runtime, lastFacts.current)
  }, [voice?.phase, voice?.target?.sessionId, voice?.target?.projectPath])
  return {
    view, hasTimeline, setView,
    publish: paint,
    receive(message: HostOutbound): boolean {
      if (message.type === 'requestNative' && message.action === 'openRealtimeThread') {
        const runtime = activeRuntime.current
        const id = (message.payload as { messageId?: unknown } | null)?.messageId
        // Only navigate within this authenticated session's delegated work.
        const valid = runtime && typeof id === 'string' && [...runtime.session.messages, ...runtime.session.realtimeThreadMessages].some(row => row.id === id
          && row.metadata?.codexTimeline?.provenance === 'realtime-delegated')
        if (valid) setView('thread', id)
        injectHostMessage(web, { type: 'nativeActionResult', requestId: message.requestId,
          ...(valid ? { result: true } : { error: 'This task is no longer loaded.' }) })
        return true
      }
      if (message.type !== 'transcriptApplied') return false
      // Receipts arrive after React paints. Jump only after the selected history is mounted.
      delivery.acknowledge(message.channelId, message.sequence)
      if (pendingJump.current && jumpReceipt.current?.channelId === message.channelId
        && jumpReceipt.current.sequence === message.sequence) {
        injectHostMessage(web, { type: 'scrollToTurn', turnId: pendingJump.current, behavior: 'auto' })
        pendingJump.current = null
        jumpReceipt.current = null
      }
      return true
    },
    reset() {
      activeRuntime.current = null
      lastFacts.current = {}
      previousSpeech.current = []
      threadCache.current = null
      pendingJump.current = null
      updateHasTimeline(false)
      viewRef.current = 'realtime'
      updateView('realtime')
      delivery.publish({ messages: [], sessionStatus: 'idle', pendingPermission: null, realtimeActivities: [], conversationView: 'thread', emptyState: null }, true)
    },
  }
}
