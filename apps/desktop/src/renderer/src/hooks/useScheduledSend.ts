import { useCallback, useEffect, useState } from 'react'
import type { ImageAttachment, ScheduledSend, ScheduledSendPatch } from '@superone/shared/agent-types'
import { callSession } from '@/lib/session-client'
import { useEnvironmentServes } from './use-environment-serves'
import { toast } from 'sonner'

/** What the composer queues: its text and the attachments sent with it. */
export interface ScheduledDraft {
  message: string | null
  attachments: ImageAttachment[]
}

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
   * Queue `draft` for `sendAt` and arm it in one write. `sessionId` overrides
   * the hook's own when arming just replaced a draft id (a remote composer's
   * first node session); the subscription follows once the view does.
   */
  schedule: (draft: ScheduledDraft, sendAt: number, sessionId?: string) => void
  /** Keep the queued text and attachments in step with the composer it mirrors. */
  setDraft: (patch: Pick<ScheduledSendPatch, 'message' | 'attachments'>) => void
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
 * read-once-then-subscribe mirror, and every mutation is an environment call
 * whose result arrives back through that same subscription rather than through
 * local state.
 */
export function useScheduledSend(
  sessionId: string | null | undefined,
  projectPath: string | null | undefined,
): ScheduledSendControls {
  const served = useEnvironmentServes(projectPath, 'session.scheduledSend.get')
  const [scheduled, setScheduled] = useState<ScheduledSend | null>(null)
  const [loading, setLoading] = useState(true)
  const [deliveredNonce, setDeliveredNonce] = useState(0)

  useEffect(() => {
    // Drop the previous session's row before the read for this one resolves.
    // Holding it across the switch would block sending in a session that has
    // nothing queued, and could write the old row's time onto the new one.
    setScheduled(null)
    if (!sessionId || !projectPath) {
      setLoading(false)
      return
    }
    setLoading(true)
    let alive = true
    void callSession(projectPath, sessionId, 'session.scheduledSend.get', {}).then(
      (row) => {
        if (!alive) return
        setScheduled(row ?? null)
        setLoading(false)
      },
      () => { if (alive) setLoading(false) },
    )
    const unsub = window.environment.onScheduledSendChanged((event) => {
      if (event.sessionId !== sessionId) return
      setScheduled(event.scheduled)
      if (event.delivered) setDeliveredNonce((n) => n + 1)
    })
    return () => {
      alive = false
      unsub()
    }
  }, [sessionId, projectPath, served])

  const patch = useCallback(
    (next: ScheduledSendPatch, target = sessionId) => {
      if (!target || !projectPath || !served) return
      void callSession(projectPath, target, 'session.scheduledSend.set', { patch: next }).catch(reportError)
    },
    [sessionId, projectPath, served],
  )

  const schedule = useCallback(
    (draft: ScheduledDraft, sendAt: number, target?: string) => {
      const attachments = draft.attachments.length > 0 ? draft.attachments : null
      patch({ armed: true, message: draft.message?.trim() || null, attachments, sendAt }, target)
    },
    [patch],
  )

  const setArmed = useCallback((armed: boolean) => patch({ armed }), [patch])
  const setDraft = useCallback((next: Pick<ScheduledSendPatch, 'message' | 'attachments'>) => patch(next), [patch])
  const setSendAt = useCallback((sendAt: number) => patch({ sendAt }), [patch])

  const clear = useCallback(() => {
    if (!sessionId || !projectPath || (!served && !scheduled)) return
    void callSession(projectPath, sessionId, 'session.scheduledSend.clear', {}).catch(reportError)
  }, [sessionId, projectPath, served, scheduled])

  return { scheduled, loading, deliveredNonce, schedule, setDraft, setArmed, setSendAt, clear }
}

function reportError(error: unknown): void { toast.error(error instanceof Error ? error.message : String(error)) }
