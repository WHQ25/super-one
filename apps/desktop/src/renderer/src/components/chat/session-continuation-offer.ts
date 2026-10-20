import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { sessionCacheExpiresAt } from '@superone/shared/session-continuation'
import { useAppStore } from '@/stores/app'
import { useActiveSession, useChatStore, useSessionScope } from '@/stores/chat'

/**
 * A long session whose prompt cache expired, offered a handoff to a new
 * session in the composer slot (docs/features/session-continuation.md).
 */
export interface SessionContinuationOffer {
  projectPath: string
  sessionId: string
  expiresAt: number
}

// Dismissing holds per session until its cache expires again (a later turn).
const dismissed = new Map<string, number>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function dismissContinuationOffer(offer: SessionContinuationOffer): void {
  if (dismissed.get(offer.sessionId) === offer.expiresAt) return
  dismissed.set(offer.sessionId, offer.expiresAt)
  for (const listener of listeners) listener()
}

/** The person is typing in this pane's editor. */
function editing(root: HTMLElement | null | undefined): boolean {
  const active = document.activeElement
  return !!active && !!root?.contains(active) && !!active.closest('[data-chat-input-editor]')
}

/** The offer for the pane's session, when one applies; `root` is the pane, to wait out typing. */
export function useSessionContinuationOffer(root?: RefObject<HTMLElement | null>): SessionContinuationOffer | null {
  const scope = useSessionScope()
  const projectPath = useChatStore((s) => scope?.projectPath ?? s.activeProject)
  const { sessionId, messages, contextTokens, status, pending, continuedIn } = useActiveSession(useShallow((s) => ({
    sessionId: scope?.sessionId ?? s._activeSessionId,
    messages: s.messages,
    contextTokens: s.contextTokens,
    status: s.status,
    pending: s.hasPendingInteraction,
    continuedIn: s._continuedIn ?? null,
  })))
  const settings = useAppStore((s) => s.sessionContinuationHint)
  const expiresAt = useMemo(
    () => (continuedIn ? null : sessionCacheExpiresAt({ messages, contextTokens, settings })),
    [continuedIn, messages, contextTokens, settings],
  )
  // The React Compiler caches `dismissed.get` against the session id alone.
  // The store snapshot has to be read here, or a dismissal stays on screen
  // until that id changes — switching to another session and back.
  const getDismissedExpiry = useCallback(
    () => (sessionId ? dismissed.get(sessionId) ?? null : null),
    [sessionId],
  )
  const dismissedExpiresAt = useSyncExternalStore(subscribe, getDismissedExpiry, getDismissedExpiry)
  const [, setRenders] = useState(0)
  useEffect(() => {
    const delay = expiresAt === null ? 0 : expiresAt - Date.now()
    if (delay <= 0) return
    // Re-render at the expiry instant; a TTL is at most an hour.
    const timer = setTimeout(() => setRenders((n) => n + 1), delay)
    return () => clearTimeout(timer)
  }, [expiresAt])
  const due = !!projectPath && !!sessionId && expiresAt !== null && Date.now() >= expiresAt
    && status === 'idle' && !pending && dismissedExpiresAt !== expiresAt
  // Taking the editor away mid-sentence loses the person's place: wait until it loses focus.
  const typing = due && editing(root?.current)
  useEffect(() => {
    if (!typing) return
    const recheck = () => setTimeout(() => setRenders((n) => n + 1))
    document.addEventListener('focusout', recheck)
    return () => document.removeEventListener('focusout', recheck)
  }, [typing])
  return due && !typing ? { projectPath: projectPath!, sessionId: sessionId!, expiresAt: expiresAt! } : null
}
