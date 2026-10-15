import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { Kv } from '@superone/relay-client'
import {
  continuationHintAt,
  DEFAULT_SESSION_CONTINUATION_HINT,
  readSessionContinuationHint,
  type SessionCacheExpiry,
  type SessionContinuationHintSettings,
} from '@superone/shared/session-continuation'
import { loadSessionContinuationHint, saveSessionContinuationHint } from '../mobile-preferences'

type Store = Pick<Kv, 'get' | 'set'>

// One copy for the settings page and the composer, read from the store once.
let current = DEFAULT_SESSION_CONTINUATION_HINT
let loading: Promise<void> | null = null
let changed = false
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const publish = (next: SessionContinuationHintSettings) => {
  current = next
  for (const listener of listeners) listener()
}

/** The device's continuation hint preference and its writer. */
export function useSessionContinuationHintSettings(store: Store) {
  const settings = useSyncExternalStore(subscribe, () => current)
  useEffect(() => {
    loading ??= loadSessionContinuationHint(store).then((stored) => { if (!changed) publish(stored) }).catch(() => {})
  }, [store])
  const update = useCallback((patch: Partial<SessionContinuationHintSettings>) => {
    changed = true
    const next = readSessionContinuationHint({ ...current, ...patch })
    publish(next)
    void saveSessionContinuationHint(store, next).catch(() => {})
  }, [store])
  return [settings, update] as const
}

/**
 * Whether the composer offers continuing `sessionId` in a new session: its
 * long session's prompt cache expired and no turn or prompt is pending.
 * `dismiss` holds per session until its cache expires again (a later turn).
 */
export function useSessionContinuationHint(input: {
  store: Store
  sessionId: string | null
  expiry: SessionCacheExpiry | null
  idle: boolean
}) {
  const [settings, update] = useSessionContinuationHintSettings(input.store)
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
  const { sessionId } = input
  const visible = !!sessionId && input.idle && expiresAt !== null && Date.now() >= expiresAt
    && dismissed[sessionId] !== expiresAt
  const dismiss = () => {
    if (sessionId && expiresAt !== null) setDismissed((value) => ({ ...value, [sessionId]: expiresAt }))
  }
  return { visible, dismiss, dontShowAgain: () => update({ enabled: false }) }
}
