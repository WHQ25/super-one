import { useEffect, useMemo, useRef, type RefObject } from 'react'
import type { WebView } from 'react-native-webview'
import type { HostOutbound } from '@superone/chat-view'
import type { ChatMessage, RealtimeTimelineSegment } from '@superone/shared/agent-types'
import { mergeRealtimeTranscript } from '@superone/shared/realtime-transcript'
import type { ChatRuntime } from '../runtime'
import { injectHostMessage } from '../native-actions'
import { TranscriptDelivery, type TranscriptSnapshot } from '../transcript-delivery'

/** Keep voice projection and document delivery out of the native sheet state updates. */
export function useTranscriptSync(web: RefObject<WebView | null>) {
  const delivery = useMemo(() => {
    const channel = new TranscriptDelivery(message => {
      // A remounted document requests a fresh hydrate via `ready`. Do not keep
      // retrying in the background after navigation has removed the WebView.
      if (!web.current) { channel.dispose(); return }
      injectHostMessage(web, message)
    })
    return channel
  }, [web])
  const activeRuntime = useRef<ChatRuntime | null>(null)
  const cache = useRef<{ messages: ChatMessage[]; segments: RealtimeTimelineSegment[]; merged: ChatMessage[] } | null>(null)
  useEffect(() => () => delivery.dispose(), [delivery])
  return {
    publish(runtime: ChatRuntime, facts: Omit<TranscriptSnapshot, 'messages'>, hydrate = false) {
      const { messages, realtimeSegments: segments } = runtime.session
      if (cache.current?.messages !== messages || cache.current.segments !== segments) {
        cache.current = { messages, segments, merged: mergeRealtimeTranscript(messages, segments) }
      }
      const changed = activeRuntime.current !== runtime
      activeRuntime.current = runtime
      delivery.publish({ ...facts, messages: cache.current.merged }, hydrate || changed)
    },
    receive(message: HostOutbound): boolean {
      if (message.type !== 'transcriptApplied') return false
      delivery.acknowledge(message.channelId, message.sequence)
      return true
    },
    reset() {
      activeRuntime.current = null
      cache.current = null
      delivery.publish({ messages: [], sessionStatus: 'idle', pendingPermission: null }, true)
    },
  }
}
