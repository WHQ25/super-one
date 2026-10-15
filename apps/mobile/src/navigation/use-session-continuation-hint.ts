import { useEffect, useState } from 'react'
import type { RelayClient } from '@superone/relay-client'
import {
  continuationHintAt,
  DEFAULT_SESSION_CONTINUATION_HINT,
  readSessionContinuationHint,
  type SessionCacheExpiry,
} from '@superone/shared/session-continuation'

/**
 * Whether the composer offers continuing `sessionId` in a new session: its
 * long session's prompt cache expired and no turn or prompt is pending.
 * The preference is the paired desktop's, read with `settings.get` on
 * connecting and on each session switch; a host without one gets the default.
 * `dismiss` holds per session until its cache expires again (a later turn).
 */
export function useSessionContinuationHint(input: {
  clientRef: { readonly current: Pick<RelayClient, 'rpc'> | null }
  connected: boolean
  sessionId: string | null
  expiry: SessionCacheExpiry | null
  idle: boolean
}) {
  const { clientRef, connected, sessionId } = input
  const [settings, setSettings] = useState(DEFAULT_SESSION_CONTINUATION_HINT)
  useEffect(() => {
    const client = clientRef.current
    if (!connected || !client) return
    let active = true
    client.rpc<{ settings?: { sessionContinuationHint?: unknown } }>('settings.get', {})
      .then((result) => { if (active) setSettings(readSessionContinuationHint(result?.settings?.sessionContinuationHint)) })
      .catch(() => {})
    return () => { active = false }
  }, [clientRef, connected, sessionId])
  const expiresAt = continuationHintAt(input.expiry, settings)
  const [dismissed, setDismissed] = useState<Record<string, number>>({})
  const [, setTick] = useState(0)
  useEffect(() => {
    const delay = expiresAt === null ? 0 : expiresAt - Date.now()
    if (delay <= 0) return
    // Re-render at the expiry instant; a TTL is at most an hour.
    const timer = setTimeout(() => setTick((n) => n + 1), delay)
    return () => clearTimeout(timer)
  }, [expiresAt])
  const visible = !!sessionId && input.idle && expiresAt !== null && Date.now() >= expiresAt
    && dismissed[sessionId] !== expiresAt
  const dismiss = () => {
    if (sessionId && expiresAt !== null) setDismissed((value) => ({ ...value, [sessionId]: expiresAt }))
  }
  return { visible, dismiss }
}
