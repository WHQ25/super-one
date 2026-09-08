import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@superone/shared/agent-types'
import { SimulatedStream } from './simulated-stream'

/** Paint-only playback: the native reducer and host projection remain authoritative. */
export function useSimulatedStream() {
  const [stream] = useState(() => new SimulatedStream())
  const [display, setDisplay] = useState(() => ({
    messages: stream.messages,
    revealingIds: new Set(stream.revealingIds),
    revealingReasoningIds: new Set(stream.revealingReasoningIds),
  }))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reducedMotion = useRef<MediaQueryList | null>(null)

  const cancel = useCallback(() => {
    if (timer.current != null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const publish = useCallback(() => {
    setDisplay({
      messages: stream.messages,
      revealingIds: new Set(stream.revealingIds),
      revealingReasoningIds: new Set(stream.revealingReasoningIds),
    })
  }, [stream])

  const schedule = useCallback(function nextFrame() {
    if (!stream.pending) {
      cancel()
      return
    }
    if (timer.current != null) return
    timer.current = setTimeout(() => {
      timer.current = null
      stream.advance(performance.now())
      publish()
      nextFrame()
    }, stream.nextDelayMs(performance.now()))
  }, [stream, cancel, publish])

  const reset = useCallback((messages: ChatMessage[] = []) => {
    cancel()
    stream.reset(messages)
    publish()
  }, [stream, cancel, publish])

  const update = useCallback((messages: ChatMessage[]) => {
    if (reducedMotion.current?.matches) stream.reset(messages)
    else stream.update(messages, performance.now())
    publish()
    schedule()
  }, [stream, publish, schedule])

  const prepend = useCallback((messages: ChatMessage[]) => {
    stream.prepend(messages)
    publish()
  }, [stream, publish])

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotion.current = preference
    const syncPreference = () => {
      if (preference.matches && stream.pending) {
        // Advancing to infinity drains the display without replacing the host data.
        stream.advance(Infinity)
        cancel()
        publish()
      }
    }
    syncPreference()
    preference.addEventListener('change', syncPreference)
    return () => {
      cancel()
      preference.removeEventListener('change', syncPreference)
    }
  }, [stream, cancel, publish])

  return { ...display, reset, update, prepend }
}
