import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScheduledSend, ScheduledSendPatch, ScheduledSendSessionInit } from '@superone/shared/agent-types'

export interface ScheduledSendControls {
  /** The queued send main owns for this session, or null when nothing is queued. */
  scheduled: ScheduledSend | null
  /**
   * The read for this session has not come back yet, so `scheduled` being null
   * means "not known", not "nothing queued". Callers that gate on the absence of
   * a schedule have to wait this out — acting on the optimistic null would let a
   * message be sent immediately *and* again when the armed row loads.
   */
  loading: boolean
  /**
   * Bumped each time main reports that the queued message actually went out, so
   * the composer that mirrors it knows when — and only when — to empty itself.
   */
  deliveredNonce: number
  /**
   * Queue `message` for `sendAt` and arm it in one write. `sessionId` overrides
   * the hook's own when arming just replaced a draft id (a remote composer's
   * first node session); the subscription follows once the view does.
   */
  schedule: (message: string | null, sendAt: number, sessionId?: string) => void
  /** Keep the queued text in step with the composer it mirrors. */
  setMessage: (message: string | null) => void
  /** Flip the arm without restating the time or the text. */
  setArmed: (armed: boolean) => void
  /** Re-time an existing queued send. */
  setSendAt: (sendAt: number) => void
  /** Forget the queued send entirely. */
  clear: () => void
}

/**
 * Renderer view of the message a session has queued for a later wall-clock time.
 *
 * The row deliberately does not live in the chat store: the case it exists for —
 * waiting out a rate-limit window — is routinely hours long, so it has to outlive
 * the pane, the window and the app run. Main owns it; this hook is the
 * read-once-then-subscribe mirror, and every mutation is a fire-and-forget IPC
 * whose result arrives back through that same subscription rather than through
 * local state.
 */
export function useScheduledSend(
  sessionId: string | null | undefined,
  /**
   * How to persist this session if arming finds it has never been sent in, and
   * a remote session's turn options. Called at write time through a ref, so a
   * changing project root does not re-subscribe and every write carries what is
   * true at that moment.
   */
  getSessionInit?: (sessionId: string) => ScheduledSendSessionInit | null,
): ScheduledSendControls {
  const [scheduled, setScheduled] = useState<ScheduledSend | null>(null)
  const [loading, setLoading] = useState(true)
  const [deliveredNonce, setDeliveredNonce] = useState(0)

  useEffect(() => {
    // Drop the previous session's row before the read for this one resolves.
    // Holding it across the switch would block sending in a session that has
    // nothing queued, and could write the old row's time onto the new one.
    setScheduled(null)
    if (!sessionId) {
      setLoading(false)
      return
    }
    setLoading(true)
    let alive = true
    void window.app.getScheduledSend(sessionId).then(
      (row) => {
        if (!alive) return
        setScheduled(row ?? null)
        setLoading(false)
      },
      () => { if (alive) setLoading(false) },
    )
    const unsub = window.app.onScheduledSendChanged((event) => {
      if (event.sessionId !== sessionId) return
      setScheduled(event.scheduled)
      if (event.delivered) setDeliveredNonce((n) => n + 1)
    })
    return () => {
      alive = false
      unsub()
    }
  }, [sessionId])

  const initRef = useRef(getSessionInit)
  initRef.current = getSessionInit

  const patch = useCallback(
    (next: ScheduledSendPatch, target = sessionId) => {
      if (!target) return
      void window.app.setScheduledSend(target, next, initRef.current?.(target) ?? undefined)
    },
    [sessionId],
  )

  const schedule = useCallback(
    (message: string | null, sendAt: number, target?: string) => {
      patch({ armed: true, message: message?.trim() || null, sendAt }, target)
    },
    [patch],
  )

  const setArmed = useCallback((armed: boolean) => patch({ armed }), [patch])
  const setMessage = useCallback((message: string | null) => patch({ message }), [patch])
  const setSendAt = useCallback((sendAt: number) => patch({ sendAt }), [patch])

  const clear = useCallback(() => {
    if (!sessionId) return
    void window.app.clearScheduledSend(sessionId)
  }, [sessionId])

  return { scheduled, loading, deliveredNonce, schedule, setMessage, setArmed, setSendAt, clear }
}
