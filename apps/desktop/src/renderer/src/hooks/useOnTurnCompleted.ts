import { useEffect, useRef } from 'react'
import { useActiveSession } from '@/stores/chat'

/**
 * Run `fn` once each time the active session's turn finishes.
 *
 * This is the refresh signal for anything derived from the repo on disk. The
 * agent is the only actor that changes git state without telling us, and it can
 * only do so during a turn — so one read per turn boundary replaces polling
 * entirely, and is *faster* than a 5s interval for the change that matters.
 *
 * Scope-aware: in a mosaic each pane observes its own session.
 */
export function useOnTurnCompleted(fn: () => void): void {
  const status = useActiveSession((s) => s.status)
  const fnRef = useRef(fn)
  const prevStatusRef = useRef(status)

  // Declared first so the callback is current before the transition check runs.
  useEffect(() => {
    fnRef.current = fn
  })

  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    // 'error' and 'background' are turn endings too — anything but staying in
    // 'streaming' means the agent stopped touching the working tree.
    if (prev === 'streaming' && status !== 'streaming') fnRef.current()
  }, [status])
}
